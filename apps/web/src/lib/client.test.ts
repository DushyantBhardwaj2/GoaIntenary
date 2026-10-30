import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { api, ApiError, clearApiRequests, core } from "./client";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
  clearApiRequests();
});
afterEach(() => {
  clearApiRequests();
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("concurrent browser GETs share one request, but settled private reads reauthorize", async () => {
  const pending = deferred<Response>();
  let calls = 0;
  globalThis.fetch = async (_url, init) => { calls++; assert.equal(init?.cache, "no-store"); return calls === 1 ? pending.promise : Response.json({ trips: [] }); };
  const first = api(`${core}/trips`);
  const second = api(`${core}/trips`);
  assert.equal(calls, 1);
  pending.resolve(Response.json({ trips: [] }));
  assert.deepEqual(await first, await second);
  await api(`${core}/trips`);
  assert.equal(calls, 2);
});

test("server requests and independently cancelled requests never share private data", async () => {
  const pending = deferred<Response>();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return (await pending.promise).clone(); };
  Reflect.deleteProperty(globalThis, "window");
  const first = api(`${core}/me`), second = api(`${core}/me`);
  assert.equal(calls, 2);
  Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
  const a = api(`${core}/trips`, { signal: new AbortController().signal });
  const b = api(`${core}/trips`, { signal: new AbortController().signal });
  assert.equal(calls, 4);
  // Each fetch receives an independent response body, as real fetch does.
  pending.resolve(Response.json({ ok: true }));
  await Promise.all([first, second, a, b]);
});

test("auth changes reject late private responses and start a fresh request", async () => {
  const pending = deferred<Response>();
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? pending.promise : Response.json({ user: { id: "new-account" } });
  const old = api(`${core}/me`);
  const rejected = assert.rejects(old, (error: unknown) => error instanceof ApiError && error.code === "STALE_REQUEST");
  clearApiRequests();
  assert.deepEqual(await api(`${core}/me`), { user: { id: "new-account" } });
  pending.resolve(Response.json({ user: { id: "old-account" } }));
  await rejected;
  assert.equal(calls, 2);
});

test("server-side unauthorized reads never use shared browser token refresh", async () => {
  Reflect.deleteProperty(globalThis, "window");
  let refreshes = 0;
  globalThis.fetch = async (url) => {
    if (String(url) === "/api/auth/refresh") refreshes++;
    return Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  };
  await assert.rejects(api(`${core}/me`), (error: unknown) => error instanceof ApiError && error.status === 401);
  assert.equal(refreshes, 0);
});

test("a write invalidates pending snapshots and a concurrent read retries once without a visible error", async () => {
  const pending = deferred<Response>();
  let reads = 0;
  globalThis.fetch = async (_url, options) => options?.method === "POST" ? Response.json({ ok: true }) : ++reads === 1 ? pending.promise : Response.json({ version: 2 });
  const old = api(`${core}/trips/trip/activities`);
  await api(`${core}/trips/trip/activities`, { method: "POST", body: "{}" });
  assert.deepEqual(await api(`${core}/trips/trip/activities`), { version: 2 });
  pending.resolve(Response.json({ version: 1 }));
  assert.deepEqual(await old, { version: 2 });
  assert.equal(reads, 3);
});

test("simultaneous expired requests use one token refresh", async () => {
  const pending = deferred<Response>();
  let refreshCalls = 0;
  const paths = new Map<string, number>();
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path === "/api/auth/refresh") { refreshCalls++; return pending.promise; }
    const count = (paths.get(path) ?? 0) + 1;
    paths.set(path, count);
    return Response.json(count === 1 ? { error: { code: "UNAUTHENTICATED" } } : { ok: true }, { status: count === 1 ? 401 : 200 });
  };
  const first = api(`${core}/trips`), second = api(`${core}/me`);
  await tick();
  assert.equal(refreshCalls, 1);
  pending.resolve(Response.json({ ok: true }));
  assert.deepEqual(await Promise.all([first, second]), [{ ok: true }, { ok: true }]);
});

test("account transitions abort an old refresh and prevent its retries", async () => {
  let refreshSignal: AbortSignal | undefined;
  let reads = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url) === "/api/auth/refresh") {
      refreshSignal = options?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => refreshSignal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    }
    reads++;
    return Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 });
  };
  const old = api(`${core}/me`);
  const rejected = assert.rejects(old, { name: "AbortError" });
  await tick();
  clearApiRequests();
  assert.equal(refreshSignal?.aborted, true);
  await rejected;
  assert.equal(reads, 1);
});

test("authorization denial stays visible and is never a cached successful result", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: { code: "FORBIDDEN", message: "You no longer have access." } }, { status: 403 }); };
  for (let i = 0; i < 2; i++) await assert.rejects(api(`${core}/trips/private`), (error: unknown) => error instanceof ApiError && error.status === 403 && error.message === "You no longer have access.");
  assert.equal(calls, 2);
});
