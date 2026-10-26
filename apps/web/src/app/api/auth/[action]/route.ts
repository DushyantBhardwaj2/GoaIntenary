import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  CognitoIdentityProviderClient, SignUpCommand, ConfirmSignUpCommand,
  InitiateAuthCommand, ForgotPasswordCommand, ConfirmForgotPasswordCommand,
  GlobalSignOutCommand, type AuthenticationResultType
} from "@aws-sdk/client-cognito-identity-provider";
import { ACCESS_COOKIE, REFRESH_COOKIE, privateHeaders, cookieOptions, sameOrigin, localAvailable, localAccounts, createLocalToken, cognitoConfigured, readBoundedBody, BodyTooLargeError } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const attempts = new Map<string, { count: number; reset: number }>();
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: privateHeaders });
const failure = (code: string, message: string, status: number) => reply({ error: { code, message } }, status);
const client = () => new CognitoIdentityProviderClient({ region: process.env.COGNITO_REGION });

function setSession(response: NextResponse, result: AuthenticationResultType) {
  if (!result.AccessToken) throw new Error("Incomplete authentication");
  response.cookies.set(ACCESS_COOKIE, result.AccessToken, { ...cookieOptions, maxAge: result.ExpiresIn ?? 3600 });
  if (result.RefreshToken) response.cookies.set(REFRESH_COOKIE, result.RefreshToken, { ...cookieOptions, maxAge: 30 * 86400 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if ((await params).action !== "status") return failure("NOT_FOUND", "Not found.", 404);
  return reply({ configured: cognitoConfigured(), localAvailable: localAvailable(request), hasSession: Boolean(request.cookies.get(ACCESS_COOKIE)?.value || request.cookies.get(REFRESH_COOKIE)?.value) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  if (!sameOrigin(request)) return failure("FORBIDDEN", "This request must come from this website.", 403);
  const { action } = await params;
  if (action === "logout") {
    const token = request.cookies.get(ACCESS_COOKIE)?.value;
    if (token && !token.startsWith("local.") && cognitoConfigured()) {
      try { await client().send(new GlobalSignOutCommand({ AccessToken: token })); } catch { /* Always remove this browser's session. */ }
    }
    const response = reply({ ok: true });
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) response.cookies.set(name, "", { ...cookieOptions, maxAge: 0 });
    return response;
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return failure("VALIDATION_ERROR", "Send a JSON request.", 400);
  if (Number(request.headers.get("content-length")) > 8192) return failure("VALIDATION_ERROR", "Request is too large.", 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(await readBoundedBody(request, 8192)); if (!body || Array.isArray(body) || typeof body !== "object") throw new Error(); } catch (e) { return failure("VALIDATION_ERROR", e instanceof BodyTooLargeError ? "Request is too large." : "Check the form and try again.", e instanceof BodyTooLargeError ? 413 : 400); }
  const text = (key: string) => typeof body[key] === "string" ? body[key] as string : "";
  const fields: Record<string, string[]> = { local: ["account"], login: ["email", "password"], register: ["email", "password", "displayName"], confirm: ["email", "code"], forgot: ["email"], reset: ["email", "code", "password"], refresh: [] };
  if (!fields[action]) return failure("NOT_FOUND", "Not found.", 404);
  if (Object.keys(body).some(key => !fields[action].includes(key) || typeof body[key] !== "string")) return failure("VALIDATION_ERROR", "Check the form fields and try again.", 400);
  if (action === "local") {
    if (!localAvailable(request)) return failure("NOT_FOUND", "Not found.", 404);
    const account = text("account");
    if (!Object.hasOwn(localAccounts, account)) return failure("VALIDATION_ERROR", "Choose an available test account.", 400);
    const response = reply({ ok: true, mode: "local" });
    response.cookies.set(REFRESH_COOKIE, "", { ...cookieOptions, maxAge: 0 });
    response.cookies.set(ACCESS_COOKIE, createLocalToken(account as keyof typeof localAccounts), { ...cookieOptions, maxAge: 3600 });
    return response;
  }
  if (!["login", "register", "confirm", "forgot", "reset", "refresh"].includes(action)) return failure("NOT_FOUND", "Not found.", 404);
  if (!cognitoConfigured()) return failure("SERVICE_UNAVAILABLE", "Email accounts are not configured yet. Your form has not been submitted to an identity service.", 503);
  const email = text("email").trim().toLowerCase();
  if (action !== "refresh" && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) return failure("VALIDATION_ERROR", "Enter a valid email address.", 400);
  if (["confirm", "reset"].includes(action) && !/^[0-9]{6,8}$/.test(text("code"))) return failure("VALIDATION_ERROR", "Enter the numeric verification code from your email.", 400);
  if (action === "reset" && (text("password").length < 8 || text("password").length > 256)) return failure("VALIDATION_ERROR", "Use a password between 8 and 256 characters.", 400);
  const key = `${action}:${action === "refresh" ? createHash("sha256").update(request.cookies.get(REFRESH_COOKIE)?.value ?? "").digest("hex") : email}`;
  if (attempts.size > 2000) attempts.clear();
  const entry = attempts.get(key);
  if (entry && entry.reset > Date.now() && entry.count >= 12) return failure("RATE_LIMITED", "Too many attempts. Please wait a few minutes.", 429);
  attempts.set(key, entry && entry.reset > Date.now() ? { ...entry, count: entry.count + 1 } : { count: 1, reset: Date.now() + 10 * 60000 });
  const ClientId = process.env.COGNITO_CLIENT_ID!;
  try {
    if (action === "login" || action === "refresh") {
      const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
      if (action === "refresh" && !refresh) return failure("UNAUTHENTICATED", "Your session has expired. Please sign in again.", 401);
      if (action === "login" && (!text("password") || text("password").length > 256)) return failure("VALIDATION_ERROR", "Enter your password.", 400);
      const result = await client().send(new InitiateAuthCommand({ ClientId, AuthFlow: action === "login" ? "USER_PASSWORD_AUTH" : "REFRESH_TOKEN_AUTH", AuthParameters: action === "login" ? { USERNAME: email, PASSWORD: text("password") } : { REFRESH_TOKEN: refresh! } }));
      if (!result.AuthenticationResult?.AccessToken) return failure("CONFLICT", "This account requires an additional sign-in challenge that this preview does not yet support.", 409);
      const response = reply({ ok: true });
      if (action === "login") response.cookies.set(REFRESH_COOKIE, "", { ...cookieOptions, maxAge: 0 });
      setSession(response, result.AuthenticationResult);
      return response;
    }
    if (action === "register") {
      if (!text("displayName").trim() || text("displayName").length > 80 || text("password").length < 12 || text("password").length > 256) return failure("VALIDATION_ERROR", "Use a name up to 80 characters and a password of at least 12 characters.", 400);
      const result = await client().send(new SignUpCommand({ ClientId, Username: email, Password: text("password"), UserAttributes: [{ Name: "email", Value: email }, { Name: "name", Value: text("displayName").trim() }] }));
      return reply({ ok: true, confirmed: Boolean(result.UserConfirmed) });
    }
    if (action === "confirm") await client().send(new ConfirmSignUpCommand({ ClientId, Username: email, ConfirmationCode: text("code") }));
    if (action === "forgot") await client().send(new ForgotPasswordCommand({ ClientId, Username: email }));
    if (action === "reset") await client().send(new ConfirmForgotPasswordCommand({ ClientId, Username: email, ConfirmationCode: text("code"), Password: text("password") }));
    return reply({ ok: true });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "UserNotConfirmedException") return failure("UNCONFIRMED", "Verify your email using the code you received, then sign in.", 409);
    if (["CodeMismatchException", "ExpiredCodeException"].includes(name)) return failure("VALIDATION_ERROR", "The verification code is incorrect or expired.", 400);
    if (name === "UsernameExistsException") return failure("CONFLICT", "An account may already use this email. Try signing in or resetting your password.", 409);
    if (name === "InvalidPasswordException") return failure("VALIDATION_ERROR", "Your password does not meet the account password rules. Use at least 12 characters with upper and lower case letters, a number, and a symbol.", 400);
    if (["NotAuthorizedException", "UserNotFoundException"].includes(name)) return failure("UNAUTHENTICATED", "Unable to sign in with these details. Check them or reset your password.", 401);
    if (["TooManyRequestsException", "LimitExceededException"].includes(name)) return failure("RATE_LIMITED", "Too many attempts. Please wait before trying again.", 429);
    return failure("SERVICE_UNAVAILABLE", "The account service is unavailable. Please try again.", 503);
  }
}
