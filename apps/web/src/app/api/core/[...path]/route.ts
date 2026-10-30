import { NextRequest, NextResponse } from "next/server";
import { ACCESS_COOKIE, privateHeaders, sameOrigin, localAvailable, readBoundedBody, BodyTooLargeError } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const fail = (code: string, message: string, status: number) => NextResponse.json({ error: { code, message } }, { status, headers: privateHeaders });

async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  if (!["GET", "HEAD"].includes(request.method) && !sameOrigin(request)) return fail("FORBIDDEN", "This request must come from this website.", 403);
  const token = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!token || (token.startsWith("local.") && !localAvailable(request))) return fail("UNAUTHENTICATED", "Your session has expired. Please sign in again.", 401);
  const { path } = await params;
  if (path[0] !== "v1" || path.some(segment => !/^[a-zA-Z0-9_-]+$/.test(segment))) return fail("NOT_FOUND", "Not found.", 404);
  if (Number(request.headers.get("content-length")) > 16384) return fail("VALIDATION_ERROR", "Request is too large.", 413);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const idempotency = request.headers.get("idempotency-key");
  if (idempotency) headers["Idempotency-Key"] = idempotency;
  let body: string | undefined;
  if (!["GET", "HEAD"].includes(request.method)) {
    try { const value = await readBoundedBody(request, 16384); if (value.trim()) { body = value; headers["Content-Type"] = "application/json"; } }
    catch (e) { return fail("VALIDATION_ERROR", e instanceof BodyTooLargeError ? "Request is too large." : "Request body is invalid.", e instanceof BodyTooLargeError ? 413 : 400); }
  }
  try {
    const base = process.env.CORE_API_URL ?? "http://127.0.0.1:4000";
    const response = await fetch(`${base.replace(/\/$/, "")}/${path.join("/")}${request.nextUrl.search}`, {
      method: request.method, headers, cache: "no-store", redirect: "error",
      body,
      signal: AbortSignal.timeout(30000)
    });
    const retryAfter = response.headers.get("retry-after");
    return new NextResponse(response.status === 204 ? null : await response.text(), { status: response.status, headers: { ...privateHeaders, "Content-Type": "application/json", ...(retryAfter && /^\d{1,6}$/.test(retryAfter) ? { "Retry-After": retryAfter } : {}) } });
  } catch { return fail("SERVICE_UNAVAILABLE", "The trip service is unavailable. Your changes have not been confirmed. Please retry.", 503); }
}
export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
export const PATCH = proxy;
export const PUT = proxy;
