"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { api, core, type ExpenseParticipant } from "@/lib/client";
import type { Stay, StayInput } from "@/lib/trip-planning-types";
import { StayMap } from "./stay-map";
import { Busy, Dialog, EmptyState, Notice } from "./ui";
import styles from "./stays.module.css";

const stayTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatStayTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return stayTime.format(date);
}

function toDateTimeLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function toKolkataIso(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error("Use a check-in and check-out time.");
  const iso = `${value.length === 16 ? `${value}:00` : value}+05:30`;
  if (Number.isNaN(new Date(iso).getTime())) throw new Error("Use a real check-in and check-out time.");
  return iso;
}

function phoneLink(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  const compact = phone.trim().replace(/[^\d+]/g, "");
  if (!/^\+?\d{7,15}$/.test(compact)) return null;
  return `tel:${compact}`;
}

function guestName(id: string, people: ExpenseParticipant[]): string {
  return people.find((person) => person.id === id)?.displayName ?? "Guest";
}

function StayDialog({ tripId, stay, participants, onClose, onSaved }: { tripId: string; stay?: Stay; participants: ExpenseParticipant[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [propertyName, setPropertyName] = useState(stay?.propertyName ?? "");
  const [address, setAddress] = useState(stay?.address ?? "");
  const [checkIn, setCheckIn] = useState(stay ? toDateTimeLocal(stay.checkIn) : "");
  const [checkOut, setCheckOut] = useState(stay ? toDateTimeLocal(stay.checkOut) : "");
  const [phone, setPhone] = useState(stay?.phone ?? "");
  const [contactName, setContactName] = useState(stay?.contactName ?? "");
  const [notes, setNotes] = useState(stay?.notes ?? "");
  const [latitude, setLatitude] = useState(stay?.latitude === null || stay?.latitude === undefined ? "" : String(stay.latitude));
  const [longitude, setLongitude] = useState(stay?.longitude === null || stay?.longitude === undefined ? "" : String(stay.longitude));
  const [guestIds, setGuestIds] = useState<string[]>(stay?.guestIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const errorId = useId();
  const toggleGuest = (id: string) => setGuestIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const knownGuestIds = new Set(participants.map((person) => person.id));
  const unseenGuestIds = guestIds.filter((id) => !knownGuestIds.has(id));
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const name = propertyName.trim();
      if (!name) throw new Error("Give the stay a property name.");
      if (name.length > 160) throw new Error("Use a property name of 160 characters or fewer.");
      if (address.trim().length > 300) throw new Error("Use an address of 300 characters or fewer.");
      if (phone.trim().length > 40) throw new Error("Use a phone number of 40 characters or fewer.");
      if (contactName.trim().length > 160) throw new Error("Use a contact name of 160 characters or fewer.");
      if (notes.trim().length > 2000) throw new Error("Use notes of 2000 characters or fewer.");
      const checkInIso = toKolkataIso(checkIn);
      const checkOutIso = toKolkataIso(checkOut);
      if (new Date(checkOutIso).getTime() <= new Date(checkInIso).getTime()) throw new Error("Check-out must be later than check-in.");
      const latitudeText = latitude.trim();
      const longitudeText = longitude.trim();
      const latitudeValue = latitudeText ? Number(latitudeText) : null;
      const longitudeValue = longitudeText ? Number(longitudeText) : null;
      if ((latitudeValue === null) !== (longitudeValue === null) || (latitudeValue !== null && (!Number.isFinite(latitudeValue) || latitudeValue < -90 || latitudeValue > 90 || longitudeValue === null || !Number.isFinite(longitudeValue) || longitudeValue < -180 || longitudeValue > 180))) {
        throw new Error("Supply both latitude and longitude, or leave both empty.");
      }
      const body: StayInput = {
        propertyName: name,
        address: address.trim(),
        latitude: latitudeValue,
        longitude: longitudeValue,
        checkIn: checkInIso,
        checkOut: checkOutIso,
        phone: phone.trim(),
        contactName: contactName.trim(),
        notes: notes.trim(),
        guestIds,
      };
      const payload = JSON.stringify(body);
      if (!stay && (!attempt.current || attempt.current.payload !== payload)) attempt.current = { payload, key: crypto.randomUUID() };
      await api(`${core}/trips/${tripId}/stays${stay ? `/${stay.id}` : ""}`, {
        method: stay ? "PATCH" : "POST",
        headers: stay ? {} : { "Idempotency-Key": attempt.current!.key },
        body: payload,
      });
      await onSaved();
      onClose();
    } catch (caught) {
      setError(message(caught, "Unable to save this stay."));
    } finally {
      setBusy(false);
    }
  };
  return <Dialog title={stay ? "Edit this stay" : "Add a stay"} onClose={onClose} busy={busy} className={styles.dialog}>
    <form className={`premium-form ${styles.form}`} onSubmit={submit} aria-describedby={error ? errorId : undefined}>
      <p className="helper-text">Times are saved in India time (Asia/Kolkata). A map pin is added only when both coordinates are filled. Booking confirmation references are saved with bookings, not on the stay.</p>
      <label>Property name<input autoFocus required maxLength={160} value={propertyName} onChange={(event) => setPropertyName(event.target.value)} /></label>
      <label>Address<input maxLength={300} value={address} onChange={(event) => setAddress(event.target.value)} autoComplete="street-address" /></label>
      <div className={styles.pair}>
        <label>Check-in<input required type="datetime-local" step={60} value={checkIn} onChange={(event) => setCheckIn(event.target.value)} /></label>
        <label>Check-out<input required type="datetime-local" step={60} value={checkOut} onChange={(event) => setCheckOut(event.target.value)} /></label>
      </div>
      <fieldset className={styles.guests}>
        <legend>Guests</legend>
        <p className="helper-text">Optional. Choose people already on this trip.</p>
        {participants.length || unseenGuestIds.length ? <div className={styles.guestList}>{participants.map((person) => <label className={styles.guest} key={person.id}><input type="checkbox" checked={guestIds.includes(person.id)} onChange={() => toggleGuest(person.id)} /><span>{person.displayName}{person.kind === "guest" ? " · Guest" : ""}</span>{!person.active && <small>Inactive</small>}</label>)}{unseenGuestIds.map((id) => <label className={styles.guest} key={id}><input type="checkbox" checked onChange={() => toggleGuest(id)} /><span>Guest</span></label>)}</div> : <p className={styles.emptyGuests}>No guests are on this trip yet. You can still save the stay.</p>}
      </fieldset>
      <div className={styles.pair}>
        <label>Property phone<input type="tel" inputMode="tel" autoComplete="tel" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
        <label>Contact name<input autoComplete="off" maxLength={160} value={contactName} onChange={(event) => setContactName(event.target.value)} /></label>
      </div>
      <label>Notes<textarea rows={3} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      <div className={styles.pair}>
        <label>Latitude<input type="number" inputMode="decimal" step="any" min={-90} max={90} value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label>
        <label>Longitude<input type="number" inputMode="decimal" step="any" min={-180} max={180} value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label>
      </div>
      <p className="helper-text">Leave both coordinates empty to remove the map pin. A stay without a pin still appears in the list.</p>
      {error && <Notice><span id={errorId}>{error}</span></Notice>}
      <div className={`dialog-actions ${styles.dialogActions}`}>
        <button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="button primary" type="submit" disabled={busy}>{busy ? <Busy text="Saving…" /> : "Save stay"}</button>
      </div>
    </form>
  </Dialog>;
}

export function StaysPanel({ tripId }: { tripId: string }) {
  const headingId = useId();
  const requestId = useRef(0);
  const [stays, setStays] = useState<Stay[]>([]);
  const [participants, setParticipants] = useState<ExpenseParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [guestWarning, setGuestWarning] = useState("");
  const [editor, setEditor] = useState<Stay | "new" | null>(null);
  const [removing, setRemoving] = useState<Stay | null>(null);
  const [busyId, setBusyId] = useState("");
  const [removeError, setRemoveError] = useState("");
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const [stayResult, peopleResult] = await Promise.allSettled([
        api<{ stays: Stay[] }>(`${core}/trips/${tripId}/stays`),
        api<{ participants: ExpenseParticipant[] }>(`${core}/trips/${tripId}/expense-participants`),
      ]);
      if (id !== requestId.current) return;
      if (stayResult.status === "rejected") {
        const text = message(stayResult.reason, "Unable to load stays.");
        setError(text);
        throw new Error(text);
      }
      setStays(stayResult.value.stays);
      setError("");
      if (peopleResult.status === "rejected") setGuestWarning(message(peopleResult.reason, "Unable to load guest names."));
      else {
        setParticipants(peopleResult.value.participants);
        setGuestWarning("");
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [tripId]);
  useEffect(() => { void load().catch(() => undefined); }, [load]);
  const removeStay = async () => {
    if (!removing) return;
    setBusyId(removing.id);
    setRemoveError("");
    try {
      await api(`${core}/trips/${tripId}/stays/${removing.id}`, { method: "DELETE" });
      setRemoving(null);
      await load();
    } catch (caught) {
      setRemoveError(message(caught, "Unable to remove this stay."));
    } finally {
      setBusyId("");
    }
  };
  return <section className={styles.panel} aria-labelledby={headingId}>
    <div className={styles.heading}>
      <div className={styles.headingCopy}>
        <span className={styles.eyebrow}>STAYS</span>
        <h2 id={headingId} className={styles.title}>Where you sleep</h2>
        <p className={styles.intro}>Keep the property, the times, and who is staying. A pin appears only when both coordinates are known.</p>
      </div>
      <div className={styles.headingActions}>
        <button type="button" className="button secondary" onClick={() => void load().catch(() => undefined)} disabled={loading}>Refresh</button>
        <button type="button" className="button primary" onClick={() => setEditor("new")}><Plus size={16} aria-hidden="true" />Add a stay</button>
      </div>
    </div>
    {error && <Notice>{error} <button type="button" className="text-button" onClick={() => void load().catch(() => undefined)}>Retry</button></Notice>}
    {guestWarning && <Notice tone="info">{guestWarning} <button type="button" className="text-button" onClick={() => void load().catch(() => undefined)}>Retry guest names</button></Notice>}
    <StayMap stays={stays} />
    {loading && stays.length === 0 ? <p className={styles.status} role="status"><Busy text="Loading stays…" /></p> : null}
    {loading && stays.length > 0 ? <p className={styles.status} role="status">Refreshing stays…</p> : null}
    {!loading && !error && stays.length === 0 ? <EmptyState title="No stay saved yet."><p>Add a house, hotel, or room. You can save it without coordinates and it will still appear in this list.</p><button type="button" className="button secondary" onClick={() => setEditor("new")}><Plus size={16} aria-hidden="true" />Add a stay</button></EmptyState> : null}
    {stays.length > 0 ? <ul className={styles.list}>{stays.map((stay) => {
      const located = typeof stay.latitude === "number" && typeof stay.longitude === "number";
      const tel = stay.phone ? phoneLink(stay.phone) : null;
      return <li key={stay.id} className={styles.card}>
        <div className={styles.cardTop}>
          <h3>{stay.propertyName}</h3>
          <span className={styles.pinNote}>{located ? "On the map" : "No map pin"}</span>
        </div>
        <dl className={styles.facts}>
          <div><dt>Address</dt><dd>{stay.address || "No address yet"}</dd></div>
          <div><dt>Check-in</dt><dd>{formatStayTime(stay.checkIn)}</dd></div>
          <div><dt>Check-out</dt><dd>{formatStayTime(stay.checkOut)}</dd></div>
          <div><dt>Guests</dt><dd>{stay.guestIds.length ? stay.guestIds.map((id) => guestName(id, participants)).join(", ") : "No guests assigned"}</dd></div>
          <div><dt>Phone</dt><dd>{stay.phone ? tel ? <a href={tel}>{stay.phone}</a> : stay.phone : "No phone yet"}</dd></div>
          <div><dt>Contact name</dt><dd>{stay.contactName || "No contact name yet"}</dd></div>
          <div><dt>Notes</dt><dd className={styles.notes}>{stay.notes || "No notes yet"}</dd></div>
        </dl>
        <div className={styles.cardActions}>
          <button type="button" className="button secondary" onClick={() => setEditor(stay)} disabled={Boolean(busyId)}>Edit</button>
          <button type="button" className="button secondary" onClick={() => { setRemoveError(""); setRemoving(stay); }} disabled={Boolean(busyId)}>Remove</button>
        </div>
      </li>;
    })}</ul> : null}
    {editor && <StayDialog key={editor === "new" ? "new" : editor.id} tripId={tripId} stay={editor === "new" ? undefined : editor} participants={participants} onClose={() => setEditor(null)} onSaved={load} />}
    {removing && <Dialog title="Remove this stay?" onClose={() => setRemoving(null)} busy={Boolean(busyId)} className={styles.dialog}>
      <p>Remove “{removing.propertyName}” from this trip? It leaves the list. A booking confirmation, if you add one later, stays with bookings.</p>
      {removeError && <Notice>{removeError}</Notice>}
      <div className={`dialog-actions ${styles.dialogActions}`}>
        <button type="button" className="button secondary" disabled={Boolean(busyId)} onClick={() => setRemoving(null)}>Keep stay</button>
        <button type="button" className="button destructive" disabled={Boolean(busyId)} onClick={() => void removeStay()}>{busyId ? <Busy text="Removing…" /> : "Remove stay"}</button>
      </div>
    </Dialog>}
  </section>;
}
