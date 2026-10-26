"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, core, type AuthStatus, type User } from "@/lib/client";
type Session = { user: User | null; status: AuthStatus | null; loading: boolean; error: string; refresh: () => Promise<void>; authenticated: () => Promise<void>; logout: () => Promise<void> };
const Context = createContext<Session | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null); const [status, setStatus] = useState<AuthStatus | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { const auth = await api<AuthStatus>("/api/auth/status"); setStatus(auth); if (auth.hasSession) { try { setUser((await api<{ user: User }>(`${core}/me`)).user); } catch (e) { if (e instanceof ApiError && e.status === 401) setUser(null); else throw e; } } else setUser(null); }
    catch (e) { setError(e instanceof Error ? e.message : "The account service is unavailable."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { const expired = () => { setUser(null); setError("Your session has expired. Sign in again to continue."); }; window.addEventListener("goa-session-expired", expired); return () => window.removeEventListener("goa-session-expired", expired); }, []);
  const authenticated = useCallback(async () => { setUser((await api<{ user: User }>(`${core}/me`)).user); setError(""); }, []);
  const logout = useCallback(async () => { await api("/api/auth/logout", { method: "POST", body: "{}" }); setUser(null); setError(""); }, []);
  return <Context.Provider value={{ user, status, loading, error, refresh, authenticated, logout }}>{children}</Context.Provider>;
}
export function useSession() { const value = useContext(Context); if (!value) throw new Error("Session provider is required"); return value; }
