"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Bookmark, ExternalLink, Heart, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api, core, type SavedPlace, type Trip } from "@/lib/client";
import type { PlaceVoteSummary } from "@/lib/trip-planning-types";
import { dayLabel, tripDays } from "@/lib/planner";
import { useSession } from "./session";
import { ActivityForm } from "./activity-form";
import { DestinationArt } from "./destination-art";
import { Busy, EmptyState, Notice } from "./ui";

const voteBlock: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "stretch", gap: 10, marginTop: 16, minWidth: 0 };
const voteCopy: CSSProperties = { margin: 0, fontSize: 14, lineHeight: 1.5, overflowWrap: "anywhere" };
const voteButton: CSSProperties = { width: "100%", maxWidth: "100%" };

function PlaceInterest({ tripId, placeId, placeTitle, reloadToken }: { tripId: string; placeId: string; placeTitle: string; reloadToken: number }) {
  const { user } = useSession();
  const summaryId = useId();
  const requestRef = useRef(0);
  const [summary, setSummary] = useState<PlaceVoteSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const votesPath = `${core}/trips/${tripId}/saved-places/${encodeURIComponent(placeId)}/votes`;

  const loadVotes = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const next = await api<PlaceVoteSummary>(votesPath);
      if (request === requestRef.current) setSummary(next);
    } catch (e) {
      if (request === requestRef.current) setError(e instanceof Error ? e.message : "Unable to load interest.");
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [votesPath]);

  useEffect(() => { void loadVotes(); }, [loadVotes, reloadToken]);

  const interested = Boolean(user && summary?.voters.some((voter) => voter.userId === user.id));
  const firstLoad = loading && !summary;

  async function toggle() {
    if (!summary || !user || saving) return;
    const request = ++requestRef.current;
    setSaving(true);
    setError("");
    try {
      const next = await api<PlaceVoteSummary>(votesPath, { method: "PUT", body: JSON.stringify({ interested: !interested }) });
      if (request === requestRef.current) setSummary(next);
    } catch (e) {
      if (request === requestRef.current) setError(e instanceof Error ? e.message : "Unable to save your interest.");
    } finally {
      if (request === requestRef.current) setSaving(false);
    }
  }

  const names = summary?.voters.map((voter) => voter.displayName).join(", ") ?? "";
  return <div className="vote-interest" style={voteBlock}>
    {firstLoad && <Busy text="Checking interest…" />}
    {error && <Notice>{error} <button type="button" className="text-button" onClick={() => void loadVotes()}>Retry</button></Notice>}
    {summary && <p id={summaryId} style={voteCopy}>{summary.count === 1 ? "1 interested" : `${summary.count} interested`}{summary.count === 0 ? <span style={{ display: "block", color: "var(--muted)" }}>No one is interested yet.</span> : <span style={{ display: "block" }}>{names}</span>}</p>}
    <button type="button" className={`button ${interested ? "primary" : "secondary"}`} style={voteButton} aria-pressed={interested} aria-label={`Interested in ${placeTitle}`} aria-describedby={summary ? summaryId : undefined} aria-busy={saving} disabled={saving || firstLoad || !summary || !user} onClick={() => void toggle()}>{saving ? <Busy text="Saving interest…" /> : <><Heart size={16} aria-hidden="true" fill={interested ? "currentColor" : "none"} />Interested</>}</button>
  </div>;
}

export function SavedPlaces({ trip, onChanged }: { trip: Trip; onChanged: () => Promise<void> }) {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [adding, setAdding] = useState<SavedPlace | null>(null);
  const [day, setDay] = useState<string | null>(trip.startDate);
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => { if (day && (day < trip.startDate || day > trip.endDate)) setDay(trip.startDate); }, [day, trip.startDate, trip.endDate]);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPlaces((await api<{ places: SavedPlace[] }>(`${core}/trips/${trip.id}/saved-places`)).places);
      setReloadToken((token) => token + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load saved places.");
    } finally {
      setLoading(false);
    }
  }, [trip.id]);
  useEffect(() => { void load(); }, [load]);

  return <section>
    <div className="section-heading">
      <div><span className="eyebrow">A LITTLE COLLECTION OF POSSIBILITIES</span><h2>Keep the good ideas.</h2></div>
      <div className="button-row no-margin">
        <button type="button" className="icon-button" aria-label="Refresh saved places" disabled={loading} onClick={() => void load()}><RefreshCw size={17} className={loading ? "spinner" : ""} /></button>
        <Link href="/explore" className="button primary">Find a place<ArrowUpRight size={17} /></Link>
      </div>
    </div>
    <p className="tab-intro">Saving a place keeps the idea. Add it to a chosen day only when you decide; nothing is booked or scheduled automatically.</p>
    <label className="saved-day-choice">When adding an idea, choose<select value={day ?? ""} onChange={e => setDay(e.target.value || null)}><option value="">Unscheduled ideas</option>{tripDays(trip.startDate, trip.endDate).map((value, i) => <option key={value} value={value}>Day {i + 1} · {dayLabel(value)}</option>)}</select></label>
    {error && <Notice>{error} <button type="button" className="text-button" onClick={() => void load()}>Retry</button></Notice>}
    {loading && !places.length ? <div className="inline-loading"><Busy text="Opening your collection…" /></div> : places.length ? <div className="saved-grid">{places.map(place => <article className="place-card saved-card" key={place.placeId}>
      <DestinationArt kind={place.category} />
      <div className="place-card-content">
        <span className="eyebrow">{place.region} GOA / {place.category}</span>
        <h3>{place.title}</h3>
        <a className="source-link" href={place.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} />Original source</a>
        <PlaceInterest tripId={trip.id} placeId={place.placeId} placeTitle={place.title} reloadToken={reloadToken} />
        <div className="saved-card-actions">
          <button type="button" className="button secondary" onClick={() => setAdding(place)}><Plus size={16} />{day ? "Add to chosen day" : "Keep as unscheduled plan"}</button>
          <button type="button" className="icon-button danger" disabled={Boolean(busy)} aria-label={`Remove saved ${place.title}`} onClick={async () => { setBusy(place.placeId); setError(""); try { await api(`${core}/trips/${trip.id}/saved-places/${place.placeId}`, { method: "DELETE" }); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to remove the place."); } finally { setBusy(""); } }}><Trash2 size={17} /></button>
        </div>
      </div>
    </article>)}</div> : <EmptyState title="Follow a little curiosity."><p>Your saved places will live here. Explore the curated Goa catalogue and bring a few ideas back to this trip.</p><Link href="/explore" className="button secondary"><Bookmark size={17} />Explore Goa</Link></EmptyState>}
    {adding && <ActivityForm trip={trip} place={adding} defaultDay={day} onClose={() => setAdding(null)} onSaved={onChanged} />}
  </section>;
}
