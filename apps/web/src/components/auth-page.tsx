"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Shell, SessionLoading } from "./shell";
import { useSession } from "./session";
import { AuthPanel } from "./auth-panel";
import { CoastArt } from "./ui";
import { safeReturnPath } from "@/lib/navigation";
export function AuthPage() {
  const { status, user, loading, authenticated } = useSession(); const router = useRouter();
  useEffect(() => { if (user) router.replace(safeReturnPath(new URLSearchParams(window.location.search).get("next"))); }, [user, router]);
  return <Shell>{loading ? <SessionLoading /> : <div className="auth-layout premium-auth"><div className="auth-story"><span className="eyebrow">COME FOR THE COAST. STAY FOR THE COMPANY.</span><h1>Good company.<br /><em>Great getaways.</em></h1><p className="lede">One thoughtful home for your dates, ideas, plans and people. Start with a little Goa.</p><CoastArt /><div className="story-foot">Invite only. Private by nature.</div></div><AuthPanel status={status} onAuthenticated={authenticated} externalMessage="" joinContext={false} /></div>}</Shell>;
}
