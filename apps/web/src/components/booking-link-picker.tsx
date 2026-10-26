"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, api, core } from "@/lib/client";
import type { Booking, BookingInput, BookingTargetType } from "@/lib/trip-planning-types";
import { Busy, Notice } from "./ui";
import styles from "./bookings.module.css";

const kindLabel: Record<BookingTargetType, string> = {
  activity: "Activity",
  stay: "Stay",
  travel: "Travel",
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function problem(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function BookingLinkPicker({ tripId, targetType, targetId }: { tripId: string; targetType: "activity" | "stay" | "travel"; targetId: string }) {
  const helpId = useId();
  const [booking, setBooking] = useState<Booking | null | undefined>(undefined);
  const [providerName, setProviderName] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const generation = useRef(0);
  const scope = `${tripId}:${targetType}:${targetId}`;
  const seen = useRef(scope);
  if (seen.current !== scope) {
    seen.current = scope;
    generation.current += 1;
    setBooking(undefined);
    setProviderName("");
    setReference("");
    setNotes("");
    setLoadError("");
    setSaveError("");
    setLoading(true);
    setBusy(false);
  }

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setLoadError("");
    try {
      const result = await api<{ bookings: Booking[] }>(`${core}/trips/${tripId}/bookings`);
      if (generation.current !== current) return;
      const match = result.bookings.find((item) => item.targetType === targetType && item.targetId.toLowerCase() === targetId.toLowerCase()) ?? null;
      setBooking(match);
      setProviderName(match?.providerName ?? "");
      setReference(match?.reference ?? "");
      setNotes(match?.notes ?? "");
    } catch (error) {
      if (generation.current !== current) return;
      setLoadError(problem(error, "Unable to load this booking."));
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [targetId, targetType, tripId]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy(true);
    setSaveError("");
    try {
      const provider = providerName.trim();
      const code = reference.trim();
      const note = notes.trim();
      if (!uuidPattern.test(targetId)) throw new Error("Choose an activity, stay, or travel segment on this trip.");
      if (!provider && !code) throw new Error("Add a provider or a booking reference.");
      if (provider.length > 160) throw new Error("Provider can be at most 160 characters.");
      if (code.length > 80) throw new Error("Reference can be at most 80 characters.");
      if (note.length > 2000) throw new Error("Notes can be at most 2000 characters.");
      const body: BookingInput = { targetType, targetId, providerName: provider, reference: code, notes: note };
      const payload = JSON.stringify(body);
      const creating = !booking;
      if (creating) {
        if (!attempt.current || attempt.current.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
      }
      try {
        await api(`${core}/trips/${tripId}/bookings${creating ? "" : `/${booking.id}`}`, {
          method: creating ? "POST" : "PATCH",
          headers: creating ? { "Idempotency-Key": attempt.current!.key } : {},
          body: payload,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 409 && creating) {
          await load();
          setSaveError("This already has a booking. Review the saved provider and reference, then save again to change them.");
          return;
        }
        throw error;
      }
      await load();
    } catch (error) {
      setSaveError(problem(error, "Unable to save this booking."));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save();
  };

  return <section className={styles.picker} aria-label={`${kindLabel[targetType]} booking`} aria-busy={loading || busy}>
    <div>
      <h3>{kindLabel[targetType]} booking</h3>
      <p className={styles.hint} id={helpId}>Provider and reference for this plan. Saving here does not purchase anything.</p>
    </div>
    {loadError && <Notice>{loadError} <button type="button" className="text-button" onClick={() => void load()}>Retry</button></Notice>}
    {loading && booking === undefined ? <div className={styles.loading}><Busy text="Looking up the booking…" /></div> : null}
    {booking !== undefined && <>
      {booking ? <dl className={styles.facts}>
        <div>
          <dt>Provider</dt>
          <dd>{booking.providerName || "Not recorded"}</dd>
        </div>
        <div>
          <dt>Reference</dt>
          <dd>{booking.reference || "Not recorded"}</dd>
        </div>
        {booking.notes ? <div><dt>Notes</dt><dd>{booking.notes}</dd></div> : null}
      </dl> : <p className={styles.empty}>No booking is linked to this yet.</p>}
      <form className={`premium-form ${styles.form}`} onSubmit={submit} autoComplete="off">
        <label>Provider <span>(optional if you add a reference)</span>
          <input maxLength={160} value={providerName} onChange={(event) => setProviderName(event.target.value)} aria-describedby={helpId} placeholder="IndiGo, the hotel, the boat desk" />
        </label>
        <label>Reference <span>(optional if you add a provider)</span>
          <input maxLength={80} spellCheck={false} autoComplete="off" value={reference} onChange={(event) => setReference(event.target.value)} aria-describedby={helpId} placeholder="PNR or confirmation code" />
        </label>
        <label>Notes <span>(optional)</span>
          <textarea rows={3} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Anything the group should know" />
        </label>
        {saveError && <Notice>{saveError} <button type="button" className="text-button" onClick={() => void save()}>Retry</button></Notice>}
        <div className={styles.saveRow}>
          <button className="button primary" type="submit" disabled={busy}>{busy ? <Busy text="Saving…" /> : booking ? "Update booking" : "Save booking"}</button>
        </div>
      </form>
    </>}
  </section>;
}
