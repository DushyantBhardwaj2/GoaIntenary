import { createHmac } from "node:crypto";

export const ACCESS_COOKIE = "goa_access";
export const REFRESH_COOKIE = "goa_refresh";
export const privateHeaders = { "Cache-Control": "private, no-store", "Pragma": "no-cache" };

export class BodyTooLargeError extends Error {}

/** Bound the stream itself: Content-Length is advisory and can be absent. */
export async function readBoundedBody(request: Request, limit: number): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new BodyTooLargeError(); }
      chunks.push(value);
    }
    const joined = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(joined);
  } finally { reader.releaseLock(); }
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  try {
    const host = request.headers.get("host");
    const expected = process.env.APP_ORIGIN
      ? new URL(process.env.APP_ORIGIN).origin
      : `${new URL(request.url).protocol}//${host}`;
    return new URL(origin).origin === expected && origin === expected;
  } catch { return false; }
}

export function localAvailable(request: Request): boolean {
  const host = request.headers.get("host") ?? "";
  return process.env.ENABLE_LOCAL_DEMO === "true"
    && process.env.NODE_ENV !== "production"
    && !process.env.AWS_LAMBDA_FUNCTION_NAME
    && (process.env.LOCAL_SESSION_SECRET?.length ?? 0) >= 32
    && /^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host);
}

export const localAccounts = {
  aman: { sub: "10000000-0000-4000-8000-000000000001", email: "aman@example.invalid", displayName: "Aman" },
  riya: { sub: "10000000-0000-4000-8000-000000000002", email: "riya@example.invalid", displayName: "Riya" },
  dev: { sub: "10000000-0000-4000-8000-000000000003", email: "dev@example.invalid", displayName: "Dev" }
} as const;

export function createLocalToken(account: keyof typeof localAccounts): string {
  const secret = process.env.LOCAL_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Local session configuration is unavailable");
  const payload = Buffer.from(JSON.stringify({ ...localAccounts[account], exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const unsigned = `local.${payload}`;
  return `${unsigned}.${createHmac("sha256", secret).update(unsigned).digest("base64url")}`;
}

export const cookieOptions = {
  httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/"
};

export function cognitoConfigured(): boolean {
  return Boolean(process.env.COGNITO_REGION && process.env.COGNITO_CLIENT_ID);
}

export { safeReturnPath } from "./navigation";
