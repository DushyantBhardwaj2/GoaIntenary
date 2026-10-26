import { test } from "node:test";
import assert from "node:assert/strict";
import { sameOrigin, localAvailable, safeReturnPath, readBoundedBody, BodyTooLargeError } from "./security";

test("mutations require the exact origin; forwarded hosts do not grant access", () => {
  const previous = process.env.APP_ORIGIN;
  delete process.env.APP_ORIGIN;
  try {
    const req = (origin?: string) => new Request("http://127.0.0.1:3000/api/auth/local", { headers: { host: "127.0.0.1:3000", ...(origin ? { origin } : {}), "x-forwarded-host": "evil.test" } });
    assert.equal(sameOrigin(req("http://127.0.0.1:3000")), true);
    for (const origin of [undefined, "null", "http://evil.test", "https://127.0.0.1:3000", "http://127.0.0.1:3000/", "http://localhost:3000"]) assert.equal(sameOrigin(req(origin)), false);
  } finally { if (previous === undefined) delete process.env.APP_ORIGIN; else process.env.APP_ORIGIN = previous; }
});

test("local accounts fail closed outside explicit development and a loopback Host", () => {
  const old = { ...process.env };
  process.env.ENABLE_LOCAL_DEMO = "true";
  process.env.LOCAL_SESSION_SECRET = "a".repeat(48);
  Object.assign(process.env, { NODE_ENV: "development" });
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  try {
    const req = (host: string) => new Request("http://127.0.0.1:3000", { headers: { host, "x-forwarded-host": "localhost" } });
    assert.equal(localAvailable(req("127.0.0.1:3000")), true);
    assert.equal(localAvailable(req("localhost:3000")), true);
    for (const host of ["example.com", "localhost.evil.test", "localhost@evil.test", "[::1]:3000", "127.0.0.1.evil.test"]) assert.equal(localAvailable(req(host)), false);
    Object.assign(process.env, { NODE_ENV: "production" });
    assert.equal(localAvailable(req("localhost:3000")), false);
  } finally { for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); }
});

test("return routes cannot navigate away from the app", () => {
  assert.equal(safeReturnPath("/join"), "/join");
  assert.equal(safeReturnPath("/trips"), "/trips");
  assert.equal(safeReturnPath("/explore"), "/explore");
  assert.equal(safeReturnPath("/trips/10000000-0000-4000-8000-000000000001"), "/trips/10000000-0000-4000-8000-000000000001");
  for (const value of [null, "//evil.test", "https://evil.test", "/auth", "/trips/../../evil", "/explore?next=https://evil.test"]) assert.equal(safeReturnPath(value), "/trips");
});

test("request byte limits apply to streams without Content-Length", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(4096)); controller.enqueue(new Uint8Array(5000)); },
    cancel() { cancelled = true; }
  });
  const request = new Request("http://localhost", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readBoundedBody(request, 8192), BodyTooLargeError);
  assert.equal(cancelled, true);
  assert.equal(await readBoundedBody(new Request("http://localhost", { method: "POST", body: "héllo" }), 6), "héllo");
  await assert.rejects(readBoundedBody(new Request("http://localhost", { method: "POST", body: "héllo" }), 5), BodyTooLargeError);
});
