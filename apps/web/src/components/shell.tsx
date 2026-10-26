"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ArrowUpRight, Compass, LogOut, Waves } from "lucide-react";
import { useSession } from "./session";
import { SunMark, Notice, Busy } from "./ui";
export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { user, status, loading, error, refresh, logout } = useSession(); const pathname = usePathname(); const [busy, setBusy] = useState(false); const [localError, setLocalError] = useState("");
  return <div className="premium-shell"><a className="skip-link" href="#main-content">Skip to content</a><header className="site-header"><Link href="/" className="site-brand" aria-label="Goa Together home"><SunMark /><span>goa<span>.</span><small>TOGETHER</small></span></Link><nav aria-label="Main navigation"><Link href="/explore" className={pathname === "/explore" ? "selected" : ""}><Compass size={16} />Explore Goa</Link><Link href="/trips" className={pathname.startsWith("/trips") ? "selected" : ""}><Waves size={16} />My trips</Link></nav><div className="site-account">{loading ? <span className="session-loading">Loading…</span> : user ? <><Link href="/trips" className="account-name"><span className="avatar coral">{user.displayName[0]}</span><span>{user.displayName}</span></Link><button className="icon-button" aria-label="Sign out" disabled={busy} onClick={async () => { setBusy(true); try { await logout(); } catch (e) { setLocalError(e instanceof Error ? e.message : "Unable to sign out."); } finally { setBusy(false); } }}><LogOut size={17} /></button></> : <Link href={`/auth?next=${encodeURIComponent(pathname === "/" ? "/trips" : pathname)}`} className="button primary small">Sign in<ArrowUpRight size={15} /></Link>}</div></header>
    {status?.localAvailable && <div className="premium-local"><strong>LOCAL REVIEW</strong><span>{user?.email?.endsWith("@example.invalid") ? `${user.displayName} is a synthetic test account.` : "Synthetic test accounts available."} Trips are saved on this computer. {status.configured ? "Cognito email sign-in is configured separately." : "Cognito email accounts await setup."}</span></div>}
    {(error || localError) && <div className="global-notice"><Notice>{error || localError} <button className="text-button" onClick={() => void refresh()}>Retry session</button></Notice></div>}
    <main id="main-content" className={wide ? "premium-main fullbleed" : "premium-main"}>{children}</main><footer className="site-footer"><Link className="footer-wordmark" href="/">goa, together.</Link><p>A little space for your people.<br />A lot of Goa ahead.</p><div><Link href="/explore">Explore Goa</Link><Link href="/trips">My trips</Link><span>Private trips. Thoughtful company.</span></div><SunMark /></footer></div>;
}
export function SessionLoading() { return <div className="loading-screen"><SunMark /><Busy text="Finding your little corner of Goa…" /></div>; }
export function AuthGate({ children, join = false }: { children: ReactNode; join?: boolean }) {
  const { user, loading } = useSession(); const pathname = usePathname();
  if (loading) return <SessionLoading />;
  if (!user) return <div className="page-heading narrow"><span className="eyebrow">YOUR PRIVATE LITTLE CORNER</span><h1>Keep your people<br /><em>in the picture.</em></h1><p>Sign in to {join ? "continue with your invitation" : "create and reopen your private trips"}.</p><Link className="button primary" href={`/auth?next=${encodeURIComponent(pathname === "/" ? "/trips" : pathname)}`}>Sign in to continue<ArrowUpRight size={17} /></Link></div>;
  return children;
}
