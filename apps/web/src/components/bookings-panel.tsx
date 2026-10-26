"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Plus, Ticket } from "lucide-react";
import { api, core, type Activity } from "@/lib/client";
import type { Booking, BookingInput, BookingTargetType, Stay, TravelSegment } from "@/lib/trip-planning-types";
import { Busy, Dialog, Notice } from "./ui";
import styles from "./bookings.module.css";

const kindLabel: Record<BookingTargetType, string> = {
  activity: "Activity",
  stay: "Stay",
  travel: "Travel",
};

type Choice = { targetType: BookingTargetType; id: string; label: string };

function problem(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function bookingName(booking: Booking, record?: string): string {
  return booking.providerName || booking.reference || record || kindLabel[booking.targetType];
}

function buildChoices(activities: Activity[], stays: Stay[], segments: TravelSegment[]): Choice[] {
  const rows: Choice[] = [
    ...activities.map((activity) => ({ targetType: "activity" as const, id: activity.id, label: activity.title.trim() || "Untitled activity" })),
    ...stays.map((stay) => ({ targetType: "stay" as const, id: stay.id, label: stay.propertyName.trim() || "Untitled stay" })),
    ...segments.map((segment) => ({ targetType: "travel" as const, id: segment.id, label: segment.title.trim() || "Untitled travel" })),
  ];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.targetType}:${row.label}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return rows.map((row) => {
    const repeated = (counts.get(`${row.targetType}:${row.label}`) ?? 0) > 1;
    return repeated ? { ...row, label: `${row.label} · ${row.id.slice(0, 8)}` } : row;
  });
}

function BookingForm({ tripId, booking, bookings, choices, choicesError, onReload, onClose, onSaved }: {
  tripId: string;
  booking?: Booking;
  bookings: Booking[];
  choices: Choice[] | null;
  choicesError: string;
  onReload: () => Promise<void>;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const helpId = useId();
  const [targetType, setTargetType] = useState<BookingTargetType>(booking?.targetType ?? "activity");
  const [targetId, setTargetId] = useState(booking?.targetId ?? "");
  const [providerName, setProviderName] = useState(booking?.providerName ?? "");
  const [reference, setReference] = useState(booking?.reference ?? "");
  const [notes, setNotes] = useState(booking?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const options = (choices ?? []).filter((choice) => choice.targetType === targetType)
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const known = options.some((choice) => choice.id.toLowerCase() === targetId.toLowerCase());
  const selectOptions = booking && booking.targetType === targetType && targetId && !known
    ? [{ targetType, id: booking.targetId, label: "Saved link (not on the trip list)" }, ...options]
    : options;

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const provider = providerName.trim();
      const code = reference.trim();
      const note = notes.trim();
      if (!targetId) throw new Error("Choose an activity, stay, or travel segment on this trip.");
      if (!provider && !code) throw new Error("Add a provider or a booking reference.");
      if (provider.length > 160) throw new Error("Provider can be at most 160 characters.");
      if (code.length > 80) throw new Error("Reference can be at most 80 characters.");
      if (note.length > 2000) throw new Error("Notes can be at most 2000 characters.");
      const taken = bookings.some((item) => item.id !== booking?.id && item.targetType === targetType && item.targetId.toLowerCase() === targetId.toLowerCase());
      if (taken) throw new Error("That record already has a booking. Edit the saved one instead.");
      const body: BookingInput = { targetType, targetId, providerName: provider, reference: code, notes: note };
      const payload = JSON.stringify(body);
      if (!booking && (!attempt.current || attempt.current.payload !== payload)) attempt.current = { payload, key: crypto.randomUUID() };
      await api(`${core}/trips/${tripId}/bookings${booking ? `/${booking.id}` : ""}`, {
        method: booking ? "PATCH" : "POST",
        headers: booking ? {} : { "Idempotency-Key": attempt.current!.key },
        body: payload,
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(problem(err, "Unable to save this booking."));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save();
  };

  return <Dialog title={booking ? "Edit this booking" : "Add a booking"} onClose={onClose} busy={busy}>
    <form className={`premium-form ${styles.form}`} onSubmit={submit} autoComplete="off">
      <p className={styles.hint} id={helpId}>One live booking for each activity, stay, or travel segment. This keeps the provider and reference.</p>
      {choicesError && <Notice>{choicesError} <button type="button" className="text-button" onClick={() => void onReload()}>Retry</button></Notice>}
      {choices === null && !choicesError ? <Busy text="Finding activities, stays, and travel…" /> : null}
      <label>Linked to
        <select value={targetType} onChange={(event) => { setTargetType(event.target.value as BookingTargetType); setTargetId(""); }}>
          <option value="activity">Activity</option>
          <option value="stay">Stay</option>
          <option value="travel">Travel</option>
        </select>
      </label>
      <label>Record
        <select required value={targetId} onChange={(event) => setTargetId(event.target.value)} aria-describedby={helpId} disabled={choices === null}>
          <option value="">Choose on this trip</option>
          {selectOptions.map((choice) => {
            const taken = bookings.some((item) => item.id !== booking?.id && item.targetType === choice.targetType && item.targetId.toLowerCase() === choice.id.toLowerCase());
            return <option key={choice.id} value={choice.id}>{taken ? `${choice.label} (has a booking)` : choice.label}</option>;
          })}
        </select>
      </label>
      {choices && selectOptions.length === 0 ? <p className={styles.hint}>Nothing of this kind is on the trip yet.</p> : null}
      <label>Provider <span>(optional if you add a reference)</span>
        <input maxLength={160} value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder="IndiGo, the hotel, the boat desk" />
      </label>
      <label>Reference <span>(optional if you add a provider)</span>
        <input maxLength={80} spellCheck={false} autoComplete="off" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="PNR or confirmation code" />
      </label>
      <label>Notes <span>(optional)</span>
        <textarea rows={3} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Anything the group should know" />
      </label>
      {error && <Notice>{error} <button type="button" className="text-button" onClick={() => void save()}>Retry</button></Notice>}
      <div className="dialog-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="button primary" type="submit" disabled={busy || choices === null}>{busy ? <Busy text="Saving…" /> : "Save booking"}</button>
      </div>
    </form>
  </Dialog>;
}

export function BookingsPanel({ tripId }: { tripId: string }) {
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [choicesError, setChoicesError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Booking | "new" | null>(null);
  const [removing, setRemoving] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const generation = useRef(0);
  const seenTrip = useRef(tripId);
  if (seenTrip.current !== tripId) {
    seenTrip.current = tripId;
    generation.current += 1;
    setBookings(null);
    setChoices(null);
    setChoicesError("");
    setError("");
    setLoading(true);
    setDraft(null);
    setRemoving(null);
    setActionError("");
  }

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const [bookingResult, activityResult, stayResult, travelResult] = await Promise.allSettled([
        api<{ bookings: Booking[] }>(`${core}/trips/${tripId}/bookings`),
        api<{ activities: Activity[] }>(`${core}/trips/${tripId}/activities`),
        api<{ stays: Stay[] }>(`${core}/trips/${tripId}/stays`),
        api<{ segments: TravelSegment[] }>(`${core}/trips/${tripId}/travel`),
      ]);
      if (generation.current !== current) return;
      if (bookingResult.status === "fulfilled") setBookings(bookingResult.value.bookings);
      else setError(problem(bookingResult.reason, "Unable to load bookings."));
      if (activityResult.status === "fulfilled" && stayResult.status === "fulfilled" && travelResult.status === "fulfilled") {
        setChoices(buildChoices(activityResult.value.activities, stayResult.value.stays, travelResult.value.segments));
        setChoicesError("");
      } else {
        setChoices(null);
        setChoicesError(bookingResult.status === "fulfilled" ? "Unable to load activities, stays, and travel for a new link." : "");
      }
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [tripId]);

  useEffect(() => { void load(); }, [load]);

  const names = new Map((choices ?? []).map((choice) => [`${choice.targetType}:${choice.id.toLowerCase()}`, choice.label]));

  const removeBooking = async () => {
    if (!removing) return;
    setBusy(true);
    setActionError("");
    try {
      await api(`${core}/trips/${tripId}/bookings/${removing.id}`, { method: "DELETE" });
      setRemoving(null);
      await load();
    } catch (err) {
      setActionError(problem(err, "Unable to remove this booking."));
    } finally {
      setBusy(false);
    }
  };

  return <section className={styles.panel} aria-label="Bookings" aria-busy={loading}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <span className={styles.kicker}><Ticket size={15} aria-hidden="true" /> CONFIRMATIONS</span>
        <h2>Bookings</h2>
        <p>Provider and reference for an activity, a stay, or a journey. One live booking for each.</p>
      </div>
      <button className="button primary" type="button" disabled={bookings === null} onClick={() => { setRemoving(null); setDraft("new"); }}>
        <Plus size={17} aria-hidden="true" />Add booking
      </button>
    </header>
    {error && <Notice>{error} <button type="button" className="text-button" onClick={() => void load()}>Retry</button></Notice>}
    {loading && bookings === null ? <div className={styles.loading}><Busy text="Finding bookings…" /></div> : null}
    {bookings && bookings.length === 0 ? <p className={styles.empty}>No bookings yet. Add the provider and reference when a plan is confirmed.</p> : null}
    {bookings && bookings.length > 0 ? <ul className={styles.list}>
      {bookings.map((booking) => {
        const record = names.get(`${booking.targetType}:${booking.targetId.toLowerCase()}`);
        const label = bookingName(booking, record);
        return <li key={booking.id}>
          <article className={styles.slip} data-target-type={booking.targetType}>
            <div className={styles.slipBody}>
              <p className={styles.kind}>{kindLabel[booking.targetType]}</p>
              <h3>{booking.providerName || "Booking"}</h3>
              {record ? <p className={styles.record}>{record}</p> : null}
              <dl className={styles.facts}>
                <div>
                  <dt>Provider</dt>
                  <dd>{booking.providerName || "Not recorded"}</dd>
                </div>
                <div>
                  <dt>Reference</dt>
                  <dd>{booking.reference || "Not recorded"}</dd>
                </div>
              </dl>
              {booking.notes ? <p>{booking.notes}</p> : null}
              <div className={styles.actions}>
                <button className="button secondary" type="button" aria-label={`Edit booking for ${label}`} onClick={() => { setRemoving(null); setDraft(booking); }}>Edit</button>
                <button className="button secondary" type="button" aria-label={`Remove booking for ${label}`} onClick={() => { setDraft(null); setActionError(""); setRemoving(booking); }}>Remove</button>
              </div>
            </div>
          </article>
        </li>;
      })}
    </ul> : null}
    {draft && <BookingForm
      tripId={tripId}
      booking={draft === "new" ? undefined : draft}
      bookings={bookings ?? []}
      choices={choices}
      choicesError={choicesError}
      onReload={load}
      onClose={() => setDraft(null)}
      onSaved={load}
    />}
    {removing && <Dialog title="Remove this booking?" onClose={() => { if (!busy) setRemoving(null); }} busy={busy}>
      <p>This hides the booking for {bookingName(removing)}. The activity, stay, or travel segment stays on the trip.</p>
      {actionError && <Notice>{actionError} <button type="button" className="text-button" onClick={() => void removeBooking()}>Retry</button></Notice>}
      <div className="dialog-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={() => setRemoving(null)}>Keep booking</button>
        <button className="button primary" type="button" disabled={busy} onClick={() => void removeBooking()}>{busy ? <Busy text="Removing…" /> : "Remove booking"}</button>
      </div>
    </Dialog>}
  </section>;
}
