"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, BedDouble, Bookmark, CalendarDays, Clock3, Edit3, ListChecks, LockKeyhole, Phone, Plane, RefreshCw, Ticket, Trash2, Users, Wallet } from "lucide-react";
import { api, core, dateRange, type TripDetail } from "@/lib/client";
import { useSession } from "./session";
import { Shell, SessionLoading, AuthGate } from "./shell";
import { Busy, Dialog, Notice, SunMark } from "./ui";
import { TripForm } from "./trip-form";
import { Planner } from "./planner";
import { SavedPlaces } from "./saved-places";
import { BudgetPanel } from "./budget";
import { PeoplePanel } from "./people";
import { TripOverview } from "./trip-overview";
import { TravelPanel } from "./travel-panel";
import { StaysPanel } from "./stays-panel";
import { BookingsPanel } from "./bookings-panel";
import { ContactsPanel } from "./contacts-panel";
import { ChecklistPanel } from "./checklist-panel";
const workspaceTabs = [
  { id: "plan", label: "The plan", icon: CalendarDays },
  { id: "saved", label: "Saved places", icon: Bookmark },
  { id: "budget", label: "Budget & splits", icon: Wallet },
  { id: "people", label: "Your people", icon: Users },
  { id: "overview", label: "Today", icon: Clock3 },
  { id: "travel", label: "Travel", icon: Plane },
  { id: "stays", label: "Stays", icon: BedDouble },
  { id: "bookings", label: "Bookings", icon: Ticket },
  { id: "contacts", label: "Contacts", icon: Phone },
  { id: "checklist", label: "Checklist", icon: ListChecks },
] as const;
type Tab = (typeof workspaceTabs)[number]["id"];
export function Workspace({ tripId }: { tripId: string }) {
  const { user, loading: sessionLoading } = useSession(); const [detail, setDetail] = useState<TripDetail | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [tab, setTab] = useState<Tab>("plan"); const [editing, setEditing] = useState(false); const [deleting, setDeleting] = useState(false); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setDetail(await api<TripDetail>(`${core}/trips/${tripId}`)); }, [tripId]);
  const refresh = useCallback(async () => { setLoading(true); setError(""); try { await load(); } catch (e) { setDetail(null); setError(e instanceof Error ? e.message : "Unable to open this trip."); } finally { setLoading(false); } }, [load]);
  useEffect(() => { if (user) void refresh(); else { setDetail(null); setLoading(false); } }, [user, refresh]);
  useEffect(() => { const initial = new URLSearchParams(window.location.search).get("tab"); if (initial && workspaceTabs.some((item) => item.id === initial)) setTab(initial as Tab); }, []);
  const selectTab = (value: Tab) => { setTab(value); window.history.replaceState(null, "", `/trips/${tripId}${value === "plan" ? "" : `?tab=${value}`}`); };
  return <Shell>{sessionLoading ? <SessionLoading /> : <AuthGate>{loading ? <SessionLoading /> : !detail ? <div className="page-heading narrow"><span className="eyebrow">A PRIVATE LITTLE SPACE</span><h1>This trip isn’t<br /><em>available here.</em></h1><p>It may be unavailable, or your account may not have access.</p>{error && <Notice>{error}</Notice>}<div className="button-row"><button className="button primary" onClick={() => void refresh()}><RefreshCw size={17} />Try again</button><Link href="/trips" className="button secondary">My trips</Link></div></div> : <><Link className="back-link" href="/trips"><ArrowLeft size={16} />Back to my trips</Link><section className="workspace-hero"><div><span className="eyebrow"><LockKeyhole size={13} />{detail.trip.region === "all" || !detail.trip.region ? "YOUR PRIVATE GOA GETAWAY" : `YOUR ${detail.trip.region.toUpperCase()} GOA GETAWAY`}</span><h1>{detail.trip.name}</h1><p>{detail.trip.description || "A fresh change of scene. Your kind of company."}</p><div className="trip-facts"><span><CalendarDays size={16} />{dateRange(detail.trip.startDate, detail.trip.endDate)}</span><span><Users size={16} />{detail.members.filter(m => m.status === "accepted").length} joined · {detail.trip.travellerCount ?? 1} planned</span></div><div className="workspace-styles">{detail.trip.styles?.map(style => <span key={style}>{style}</span>)}</div></div><div className="workspace-hero-right"><div className="trip-sun"><SunMark /><span>GOOD DAYS<br />AHEAD</span></div>{detail.trip.role === "organiser" && <div className="workspace-settings"><button className="text-button" onClick={() => setEditing(true)}><Edit3 size={14} />Edit trip</button><button className="icon-button danger" aria-label="Delete trip" onClick={() => setDeleting(true)}><Trash2 size={16} /></button></div>}</div></section><nav className="workspace-tabs" aria-label="Trip workspace">{workspaceTabs.map(item => <button type="button" key={item.id} className={tab === item.id ? "selected" : ""} style={{ flexShrink: 0 }} aria-pressed={tab === item.id} onClick={() => selectTab(item.id)}><item.icon size={17} />{item.label}</button>)}</nav><div className="workspace-tab-content">{tab === "plan" ? <Planner trip={detail.trip} onChanged={load} /> : tab === "saved" ? <SavedPlaces trip={detail.trip} onChanged={load} /> : tab === "budget" ? <BudgetPanel trip={detail.trip} onChanged={load} /> : tab === "people" ? <PeoplePanel detail={detail} onChanged={load} /> : tab === "overview" ? <TripOverview tripId={detail.trip.id} /> : tab === "travel" ? <TravelPanel tripId={detail.trip.id} /> : tab === "stays" ? <StaysPanel tripId={detail.trip.id} /> : tab === "bookings" ? <BookingsPanel tripId={detail.trip.id} /> : tab === "contacts" ? <ContactsPanel tripId={detail.trip.id} /> : <ChecklistPanel tripId={detail.trip.id} />}</div>{editing && <TripForm trip={detail.trip} onClose={() => setEditing(false)} onSaved={trip => { setDetail({ ...detail, trip }); setEditing(false); }} />}{deleting && <Dialog title="Let this getaway go?" busy={busy} onClose={() => setDeleting(false)}><p>Delete “{detail.trip.name}”? It will disappear for every member, and its invitations will stop working.</p>{error && <Notice>{error}</Notice>}<div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={() => setDeleting(false)}>Keep my trip</button><button className="button destructive" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await api(`${core}/trips/${tripId}`, { method: "DELETE" }); window.location.assign("/trips"); } catch (e) { setError(e instanceof Error ? e.message : "Unable to delete this trip."); } finally { setBusy(false); } }}>{busy ? <Busy /> : "Delete trip"}</button></div></Dialog>}</>}</AuthGate>}</Shell>;
}
