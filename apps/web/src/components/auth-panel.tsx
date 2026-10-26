"use client";
import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, ChevronRight, LoaderCircle } from "lucide-react";
import { api, ApiError, type AuthStatus } from "@/lib/client";
import { Notice, Busy } from "./ui";

type AuthView = "login" | "register" | "confirm" | "forgot" | "reset";
export function AuthPanel({ status, onAuthenticated, externalMessage, joinContext }: { status: AuthStatus | null; onAuthenticated: () => Promise<void>; externalMessage: string; joinContext: boolean }) {
  const [mode, setMode] = useState<AuthView>("login");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const changeMode = (next: AuthView) => { setMode(next); setError(""); setMessage(""); setPassword(""); setCode(""); };
  const titles = { login: "Your people are waiting.", register: "Make yourself at home.", confirm: "Check your inbox.", forgot: "Let’s get you back in.", reset: "A fresh start." };
  const descriptions = { login: joinContext ? "Sign in to continue with your invitation." : "Sign in to your own little corner of Goa.", register: "Create your account with email and password.", confirm: "Enter the verification code sent to your email.", forgot: "We’ll ask the account service to send a reset code.", reset: "Enter your reset code and choose a new password." };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return; setBusy("email"); setError(""); setMessage("");
    try {
      const payload = { email, ...(["login", "register", "reset"].includes(mode) ? { password } : {}), ...(mode === "register" ? { displayName } : {}), ...(["confirm", "reset"].includes(mode) ? { code } : {}) };
      const result = await api<{ confirmed?: boolean }>(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify(payload) });
      setPassword("");
      if (mode === "login") await onAuthenticated();
      if (mode === "register") { setMode(result.confirmed ? "login" : "confirm"); setMessage(result.confirmed ? "Your account is ready. Sign in to continue." : "Your account service accepted registration. Enter the email verification code to finish."); }
      if (mode === "confirm") { setMode("login"); setMessage("Email verified. Sign in to continue."); }
      if (mode === "forgot") { setMode("reset"); setMessage("If this email is eligible, the account service will send a reset code."); }
      if (mode === "reset") { setMode("login"); setMessage("Password reset. Sign in with your new password."); }
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to reach the account service."); if (e instanceof ApiError && e.code === "UNCONFIRMED") setMode("confirm"); }
    finally { setBusy(""); }
  };
  const localLogin = async (account: string) => {
    if (busy) return; setBusy(account); setError("");
    try { await api("/api/auth/local", { method: "POST", body: JSON.stringify({ account }) }); await onAuthenticated(); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to enter the local review."); }
    finally { setBusy(""); }
  };
  return <section className="auth-panel panel"><span className="eyebrow">{mode === "register" ? "YOUR FIRST STEP, RIGHT HERE" : "HELLO AGAIN, TRAVELLER"}</span><h2>{titles[mode]}</h2><p>{descriptions[mode]}</p>{!status?.configured && <Notice tone="info">Email sign-in is awaiting Cognito setup. Registration, verification and password reset are unavailable until it’s connected.</Notice>}{(message || externalMessage) && <Notice tone="success">{message || externalMessage}</Notice>}{error && <Notice>{error}</Notice>}
    <form onSubmit={submit}>{mode === "register" && <label>Your name<input name="displayName" autoComplete="name" required maxLength={80} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="What should we call you?" /></label>}<label>Email address<input name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>{["confirm", "reset"].includes(mode) && <label>Verification code<input name="code" inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={e => setCode(e.target.value)} placeholder="Code from your email" /></label>}{["login", "register", "reset"].includes(mode) && <label>{mode === "reset" ? "New password" : "Password"}<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "login" ? 1 : 8} maxLength={256} value={password} onChange={e => setPassword(e.target.value)} placeholder={mode === "login" ? "Your password" : "At least 8 characters"} /></label>}{mode === "login" && <button type="button" className="text-button forgot" onClick={() => changeMode("forgot")}>Forgot password?</button>}<button className="button primary full" type="submit" disabled={Boolean(busy) || !status?.configured}>{busy === "email" ? <Busy /> : <>{({ login: "Sign in", register: "Create account", confirm: "Verify email", forgot: "Send reset code", reset: "Reset password" })[mode]}<ArrowUpRight size={17} /></>}</button></form>
    <div className="auth-switch">{mode === "login" ? <>New around here? <button className="text-button" onClick={() => changeMode("register")}>Create an account</button></> : <button className="text-button" onClick={() => changeMode("login")}><ArrowLeft size={13} />Back to sign in</button>}{mode === "login" && <button className="text-button verify-link" onClick={() => changeMode("confirm")}>Verify an existing account</button>}</div>
    {status?.localAvailable && <div className="local-accounts"><span className="eyebrow">TAKE THE LOCAL REVIEW FOR A SPIN</span><p>Use a labelled synthetic account to try real, saved trips. No password or email is created.</p><div>{[{ id: "aman", name: "Aman", role: "Start a trip" }, { id: "riya", name: "Riya", role: "Join a friend" }, { id: "dev", name: "Dev", role: "Check privacy" }].map(account => <button key={account.id} disabled={Boolean(busy)} onClick={() => void localLogin(account.id)}><span className={`avatar ${account.id === "aman" ? "coral" : ""}`}>{busy === account.id ? <LoaderCircle size={15} className="spinner" /> : account.name[0]}</span><strong>{account.name}</strong><small>{account.role}</small><ChevronRight size={14} /></button>)}</div></div>}
  </section>;
}
