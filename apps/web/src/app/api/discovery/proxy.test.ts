import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { NextRequest } from "next/server";
import { GET } from "./[...path]/route";

const originalFetch = globalThis.fetch;
const originalBase = process.env.DISCOVERY_API_URL;
afterEach(() => { globalThis.fetch = originalFetch; });
after(() => { if (originalBase === undefined) delete process.env.DISCOVERY_API_URL; else process.env.DISCOVERY_API_URL = originalBase; });

function request(path = ["places"], query = "", headers?: Record<string, string>) {
  return GET(new NextRequest(`http://127.0.0.1:3000/api/discovery/${path.join("/")}${query}`, { headers }), { params: Promise.resolve({ path }) });
}

test("public proxy forwards only known routes and filters, without account headers", async () => {
  process.env.DISCOVERY_API_URL = "http://127.0.0.1:4100";
  let target: string | undefined;
  let options: RequestInit | undefined;
  globalThis.fetch = async (url, init) => {
    target = String(url); options = init;
    return Response.json({ places: [], total: 0, catalogue: { kind: "curated", checkedAt: "2026-10-21T10:26:11Z", notice: "Curated catalogue" } });
  };
  const response = await request(["places"], "?q=Old%20Goa&category=culture&region=central", { Cookie: "private=session", Authorization: "Bearer secret" });
  assert.equal(response.status, 200);
  assert.equal(target, "http://127.0.0.1:4100/v1/places?q=Old+Goa&category=culture&region=central");
  assert.deepEqual(options?.headers, { Accept: "application/json" });
  assert.equal(options?.redirect, "error");
  assert.match(response.headers.get("cache-control") ?? "", /public/);
});

test("empty filters are valid; details route has no filters", async () => {
  let target = "";
  globalThis.fetch = async (url) => { target = String(url); return Response.json({ place: { id: "palolem-beach" } }); };
  assert.equal((await request(["places"], "?q=&category=&region=")).status, 200);
  assert.equal(target, "http://127.0.0.1:4100/v1/places");
  assert.equal((await request(["places", "palolem-beach"])).status, 200);
  assert.equal(target, "http://127.0.0.1:4100/v1/places/palolem-beach");
  assert.equal((await request(["places", "palolem-beach"], "?q=Goa")).status, 400);
});

test("invalid filters and arbitrary proxy paths never make an upstream call", async () => {
  globalThis.fetch = async () => { throw new Error("Validation must happen before fetch"); };
  for (const query of ["?region=west", "?category=restaurant", "?q=x&q=y", "?url=http://example.test", "?q=%00", `?q=${"x".repeat(81)}`]) {
    assert.equal((await request(["places"], query)).status, 400, query);
  }
  for (const path of [["health"], ["v1", "trips"], ["places", "bad_id"], ["places", "id", "private"]]) {
    assert.equal((await request(path)).status, 404);
  }
});

test("unavailable and invalid discovery responses give retryable errors, never fake places", async () => {
  for (const mode of ["network", "error", "invalid-json", "html"]) {
    globalThis.fetch = async () => {
      if (mode === "network") throw new Error("Offline");
      if (mode === "error") return new Response("", { status: 500 });
      if (mode === "invalid-json") return new Response("{bad", { headers: { "Content-Type": "application/json" } });
      return new Response("<html>Unavailable</html>", { headers: { "Content-Type": "text/html" } });
    };
    const response = await request();
    assert.equal(response.status, 503, mode);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("retry-after"), "30");
    assert.equal((await response.json()).error.code, "SERVICE_UNAVAILABLE");
  }
});

test("not-found and validation statuses survive the public boundary", async () => {
  for (const status of [400, 404]) {
    globalThis.fetch = async () => Response.json({ error: { code: "ERROR" } }, { status });
    assert.equal((await request()).status, status);
  }
});

test("invalid configured service schemes fail closed", async () => {
  process.env.DISCOVERY_API_URL = "file:///etc/passwd";
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json({}); };
  assert.equal((await request()).status, 503);
  assert.equal(calls, 0);
});

test("map search uses the bounded public search route and preserves provider failure metadata", async () => {
  process.env.DISCOVERY_API_URL = "http://127.0.0.1:4100";
  let target="",calls=0;
  globalThis.fetch=async(url,options)=>{target=String(url);calls++;assert.deepEqual(options?.headers,{Accept:"application/json"});return Response.json({places:[],providerAvailable:false,providerNotice:"Wider search unavailable"});};
  assert.equal((await request(["search"],"?q=ab")).status,400);
  assert.equal((await request(["search"],"?q=Palom&q=Beach")).status,400);
  assert.equal((await request(["search","private"],"?q=Palom")).status,404);
  assert.equal(calls,0);
  const response=await request(["search"],"?q=Palom%20Beach&region=south",{Cookie:"private=session"});
  assert.equal(response.status,200);assert.equal(target,"http://127.0.0.1:4100/v1/search?q=Palom+Beach&region=south");assert.equal(response.headers.get("cache-control"),"no-store");assert.equal((await response.json()).providerAvailable,false);
});
