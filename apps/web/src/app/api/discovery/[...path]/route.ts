import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const categories = new Set(["beach", "food", "cafe", "nightlife", "culture", "adventure", "shopping", "transport", "other"]);
const regions = new Set(["north", "south", "central", "all"]);
const publicHeaders = { "Cache-Control": "public, max-age=300, s-maxage=300", "X-Content-Type-Options": "nosniff" };

function fail(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(status === 503 ? { "Retry-After": "30" } : {}) },
  });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const searching = path.length === 1 && path[0] === "search";
  if (!searching && (path[0] !== "places" || path.length > 2 || (path[1] && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path[1])) || (path[1]?.length ?? 0) > 80)) {
    return fail("NOT_FOUND", "This discovery route was not found.", 404);
  }
  const incoming = request.nextUrl.searchParams;
  const query = new URLSearchParams();
  if (request.nextUrl.search.length > 1024) return fail("VALIDATION_ERROR", "The search is too long.", 400);
  if (path.length === 2 && incoming.size) return fail("VALIDATION_ERROR", "Place details do not accept query filters.", 400);
  for (const [key, value] of incoming) {
    if (!["q", "category", "region"].includes(key) || incoming.getAll(key).length !== 1) {
      return fail("VALIDATION_ERROR", "Use one value for each supported search filter.", 400);
    }
    if ((key === "q" && (Array.from(value).length > 80 || /[\u0000-\u001f\u007f]/.test(value)))
      || (key === "category" && value !== "" && !categories.has(value))
      || (key === "region" && value !== "" && !regions.has(value))) {
      return fail("VALIDATION_ERROR", "Use a search of at most 80 characters and a supported category or Goa region.", 400);
    }
    if (value) query.set(key, value);
  }
  if (searching && (query.get("q")?.trim().length ?? 0) < 3) return fail("VALIDATION_ERROR", "Type at least three characters to search the Goa map.", 400);

  try {
    const base = new URL(process.env.DISCOVERY_API_URL ?? "http://127.0.0.1:4100");
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("Invalid discovery service configuration");
    const target = `${base.href.replace(/\/$/, "")}/v1/${path.join("/")}${query.size ? `?${query}` : ""}`;
    // Discovery is public: never forward the browser's session, cookies or arbitrary headers.
    const upstream = await fetch(target, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (upstream.status === 404) return fail("NOT_FOUND", "This place was not found.", 404);
    if (upstream.status === 400) return fail("VALIDATION_ERROR", "The discovery search is invalid.", 400);
    if (!upstream.ok || !upstream.headers.get("content-type")?.includes("application/json")) throw new Error("Discovery unavailable");
    const data = await upstream.json();
    return NextResponse.json(data, { headers: searching ? { ...publicHeaders,"Cache-Control": data.providerAvailable === false ? "no-store" : "public, max-age=30, s-maxage=30" } : publicHeaders });
  } catch {
    return fail("SERVICE_UNAVAILABLE", "Goa discovery is temporarily unavailable. Please retry; your saved trip plans are unchanged.", 503);
  }
}
