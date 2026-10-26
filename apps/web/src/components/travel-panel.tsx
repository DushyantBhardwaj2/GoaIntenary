"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Bus, Plane, Plus, TrainFront } from "lucide-react";
import { api, core, type ExpenseParticipant } from "@/lib/client";
import type { TravelMode, TravelSegment } from "@/lib/trip-planning-types";
import { Busy, Dialog, EmptyState, Notice } from "./ui";
import styles from "./travel.module.css";

const modes: { value: TravelMode; label: string }[] = [
  { value: "flight", label: "Flight" },
  { value: "train", label: "Train" },
  { value: "bus", label: "Bus" },
];

const modeIcon = { flight: Plane, train: TrainFront, bus: Bus };

const timeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function formatWhen(iso: string): string {
  return timeFormat.format(new Date(iso));
}

function kolkataLocalValue(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const hour = pick("hour") === "24" ? "00" : pick("hour");
  return `${pick("year")}-${pick("month")}-${pick("day")}T${hour}:${pick("minute")}:${pick("second")}`;
}

function kolkataInstant(local: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(local);
  if (!match) throw new Error("Choose a valid time.");
  return `${match[1]}T${match[2]}:${match[3]}:${match[4] ?? "00"}+05:30`;
}

function sortSegments(segments: TravelSegment[]): TravelSegment[] {
  return [...segments].sort((left, right) => left.departureAt.localeCompare(right.departureAt) || left.id.localeCompare(right.id));
}

function TravelForm({ tripId, segment, participants, participantError, onRetryParticipants, onClose, onSaved }: {
  tripId: string;
  segment?: TravelSegment;
  participants: ExpenseParticipant[];
  participantError: string;
  onRetryParticipants: () => void;
  onClose: () => void;
  onSaved: (segment: TravelSegment) => void;
}) {
  const baseId = useId();
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const [mode, setMode] = useState<TravelMode>(segment?.mode ?? "flight");
  const [title, setTitle] = useState(segment?.title ?? "");
  const [departurePlace, setDeparturePlace] = useState(segment?.departurePlace ?? "");
  const [arrivalPlace, setArrivalPlace] = useState(segment?.arrivalPlace ?? "");
  const [departureLocal, setDepartureLocal] = useState(segment ? kolkataLocalValue(segment.departureAt) : "");
  const [arrivalLocal, setArrivalLocal] = useState(segment?.arrivalAt ? kolkataLocalValue(segment.arrivalAt) : "");
  const [departureTerminal, setDepartureTerminal] = useState(segment?.departureTerminal ?? "");
  const [arrivalTerminal, setArrivalTerminal] = useState(segment?.arrivalTerminal ?? "");
  const [selected, setSelected] = useState<string[]>(segment?.travellerIds ?? []);
  const [bookingReference, setBookingReference] = useState(segment?.bookingReference ?? "");
  const [notes, setNotes] = useState(segment?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!title.trim()) throw new Error("Give the segment a title.");
      if (!departurePlace.trim()) throw new Error("Name the departure place.");
      if (!arrivalPlace.trim()) throw new Error("Name the arrival place.");
      if (!departureLocal) throw new Error("Choose a departure time.");
      const departureAt = kolkataInstant(departureLocal);
      const arrivalAt = arrivalLocal ? kolkataInstant(arrivalLocal) : null;
      if (arrivalAt && new Date(arrivalAt).getTime() < new Date(departureAt).getTime()) throw new Error("Arrival must be at the same time as departure or later.");
      const payload = JSON.stringify({
        mode,
        title: title.trim(),
        departurePlace: departurePlace.trim(),
        arrivalPlace: arrivalPlace.trim(),
        departureAt,
        arrivalAt,
        departureTerminal: departureTerminal.trim(),
        arrivalTerminal: arrivalTerminal.trim(),
        bookingReference: bookingReference.trim(),
        notes: notes.trim(),
        travellerIds: selected,
      });
      const headers: Record<string, string> = {};
      if (!segment) {
        if (!attempt.current || attempt.current.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
        headers["Idempotency-Key"] = attempt.current.key;
      }
      const saved = await api<{ segment: TravelSegment }>(`${core}/trips/${tripId}/travel${segment ? `/${segment.id}` : ""}`, { method: segment ? "PATCH" : "POST", headers, body: payload });
      onSaved(saved.segment);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save this journey.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return <Dialog className={styles.dialog} title={segment ? "Edit this journey" : "Add a journey"} onClose={onClose} busy={busy}>
    <form className={`premium-form ${styles.form}`} onSubmit={submit}>
      <p className="form-intro">Times are India time, even when this phone is set somewhere else. Saving keeps the journey with the trip. It does not book a ticket.</p>
      <label htmlFor={`${baseId}-mode`}>How are you travelling?
        <select id={`${baseId}-mode`} value={mode} onChange={(event) => setMode(event.target.value as TravelMode)}>
          {modes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label htmlFor={`${baseId}-title`}>Journey name
        <input id={`${baseId}-title`} autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Mumbai to Goa" />
      </label>
      <label htmlFor={`${baseId}-from`}>Departure place
        <input id={`${baseId}-from`} required maxLength={200} value={departurePlace} onChange={(event) => setDeparturePlace(event.target.value)} placeholder="Mumbai airport" />
      </label>
      <label htmlFor={`${baseId}-to`}>Arrival place
        <input id={`${baseId}-to`} required maxLength={200} value={arrivalPlace} onChange={(event) => setArrivalPlace(event.target.value)} placeholder="Goa airport" />
      </label>
      <label htmlFor={`${baseId}-depart`}>Departure
        <input id={`${baseId}-depart`} required type="datetime-local" step={1} value={departureLocal} onChange={(event) => setDepartureLocal(event.target.value)} />
      </label>
      <label htmlFor={`${baseId}-arrive`}>Arrival <span>(optional)</span>
        <input id={`${baseId}-arrive`} type="datetime-local" step={1} value={arrivalLocal} onChange={(event) => setArrivalLocal(event.target.value)} />
      </label>
      <p className="helper-text">Leave arrival empty if you only know when you leave. An arrival has to be the same time or later.</p>
      <label htmlFor={`${baseId}-depart-terminal`}>Departure terminal <span>(optional)</span>
        <input id={`${baseId}-depart-terminal`} maxLength={120} value={departureTerminal} onChange={(event) => setDepartureTerminal(event.target.value)} placeholder="Terminal 2, Gate 14" />
      </label>
      <label htmlFor={`${baseId}-arrive-terminal`}>Arrival terminal <span>(optional)</span>
        <input id={`${baseId}-arrive-terminal`} maxLength={120} value={arrivalTerminal} onChange={(event) => setArrivalTerminal(event.target.value)} placeholder="Arrival hall" />
      </label>
      <fieldset className={styles.travellers}>
        <legend>Travellers</legend>
        {participantError && <Notice>{participantError} <button type="button" className="text-button" onClick={onRetryParticipants}>Try again</button></Notice>}
        {participants.length === 0 && !participantError && <p className="helper-text">No travellers are listed yet. You can still save the journey.</p>}
        {participants.map((person) => <label className={`checkbox-label ${styles.choice}`} key={person.id}>
          <input type="checkbox" checked={selected.includes(person.id)} onChange={() => toggle(person.id)} />
          <span>{person.displayName}{person.kind === "guest" ? " (guest)" : ""}{person.active ? "" : " (no longer active)"}</span>
        </label>)}
      </fieldset>
      <p className="helper-text">Leave everyone unchecked when the journey has no named travellers yet.</p>
      <label htmlFor={`${baseId}-reference`}>Booking reference
        <input id={`${baseId}-reference`} type="text" maxLength={80} autoComplete="off" spellCheck={false} value={bookingReference} onChange={(event) => setBookingReference(event.target.value)} placeholder="Booking reference" />
      </label>
      <p className="helper-text">Accepted members of this trip can see this reference. It is stored with the journey, not booked from here.</p>
      <label htmlFor={`${baseId}-notes`}>Notes <span>(optional)</span>
        <textarea id={`${baseId}-notes`} rows={3} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Anything worth remembering" />
      </label>
      {error && <Notice>{error}</Notice>}
      <div className={`dialog-actions ${styles.actions}`}>
        <button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="button primary" type="submit" disabled={busy}>{busy ? <Busy text="Saving…" /> : "Save journey"}</button>
      </div>
    </form>
  </Dialog>;
}

export function TravelPanel({ tripId }: { tripId: string }) {
  const headingId = useId();
  const requestId = useRef(0);
  const [segments, setSegments] = useState<TravelSegment[] | null>(null);
  const [participants, setParticipants] = useState<ExpenseParticipant[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [participantError, setParticipantError] = useState("");
  const [editor, setEditor] = useState<TravelSegment | "create" | null>(null);
  const [removing, setRemoving] = useState<TravelSegment | null>(null);
  const [removeError, setRemoveError] = useState("");
  const [removingBusy, setRemovingBusy] = useState(false);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    const [travelResult, peopleResult] = await Promise.allSettled([
      api<{ segments: TravelSegment[] }>(`${core}/trips/${tripId}/travel`),
      api<{ participants: ExpenseParticipant[] }>(`${core}/trips/${tripId}/expense-participants`),
    ]);
    if (id !== requestId.current) return;
    if (travelResult.status === "fulfilled") {
      setSegments(sortSegments(travelResult.value.segments));
      setLoadError("");
    } else {
      setLoadError(travelResult.reason instanceof Error ? travelResult.reason.message : "Unable to load journeys.");
    }
    if (peopleResult.status === "fulfilled") {
      setParticipants(peopleResult.value.participants);
      setParticipantError("");
    } else {
      setParticipantError(peopleResult.reason instanceof Error ? peopleResult.reason.message : "Unable to load travellers.");
    }
    setLoading(false);
  }, [tripId]);

  useEffect(() => {
    setSegments(null);
    setParticipants([]);
    setLoadError("");
    setParticipantError("");
    setEditor(null);
    setRemoving(null);
    void load();
    return () => { requestId.current += 1; };
  }, [load]);

  const names = (ids: string[]) => ids.map((id) => participants.find((person) => person.id === id)?.displayName ?? "Traveller").join(", ");

  const remove = async () => {
    if (!removing) return;
    setRemovingBusy(true);
    setRemoveError("");
    try {
      await api(`${core}/trips/${tripId}/travel/${removing.id}`, { method: "DELETE" });
      const removedId = removing.id;
      setSegments((current) => (current ?? []).filter((item) => item.id !== removedId));
      setRemoving(null);
      void load();
    } catch (caught) {
      setRemoveError(caught instanceof Error ? caught.message : "Unable to remove this journey.");
    } finally {
      setRemovingBusy(false);
    }
  };

  return <section className={styles.panel} aria-labelledby={headingId} aria-busy={loading}>
    <div className={styles.header}>
      <div>
        <p className={styles.kicker}>FLIGHTS, TRAINS AND BUSES</p>
        <h2 id={headingId}>Getting there</h2>
        <p className={styles.intro}>Add each flight, train, or bus. Accepted members can see the times, terminals, and booking reference.</p>
      </div>
      {segments && <button type="button" className={`button primary ${styles.headerAction}`} onClick={() => { setRemoving(null); setEditor("create"); }}><Plus size={17} />Add a journey</button>}
    </div>
    {loadError && <Notice>{loadError} <button type="button" className="text-button" onClick={() => void load()}>Try again</button></Notice>}
    {segments === null && loading && <div className={styles.loading} role="status"><Busy text="Loading journeys…" /></div>}
    {segments && segments.length === 0 && <EmptyState title="No journeys saved yet"><p>Add the flight, train, or bus you are taking. Nothing is booked from here.</p></EmptyState>}
    {segments && segments.length > 0 && <ul className={styles.list} aria-label="Saved journeys">
      {segments.map((segment) => {
        const Icon = modeIcon[segment.mode];
        const label = modes.find((item) => item.value === segment.mode)?.label ?? segment.mode;
        return <li className={styles.card} key={segment.id}>
          <p className={styles.mode} data-mode={segment.mode}>{Icon && <Icon size={15} aria-hidden="true" />}{label}</p>
          <h3>{segment.title}</h3>
          <p className={styles.route}>{segment.departurePlace} to {segment.arrivalPlace}</p>
          <dl className={styles.facts}>
            <div><dt>Departs</dt><dd><time dateTime={segment.departureAt}>{formatWhen(segment.departureAt)}</time></dd></div>
            <div><dt>Arrives</dt><dd>{segment.arrivalAt ? <time dateTime={segment.arrivalAt}>{formatWhen(segment.arrivalAt)}</time> : "Not set"}</dd></div>
            {segment.departureTerminal && <div><dt>Departure terminal</dt><dd>{segment.departureTerminal}</dd></div>}
            {segment.arrivalTerminal && <div><dt>Arrival terminal</dt><dd>{segment.arrivalTerminal}</dd></div>}
            <div><dt>Booking reference</dt><dd className={styles.reference}>{segment.bookingReference || "Not added"}</dd></div>
            {segment.travellerIds.length > 0 && <div><dt>Travellers</dt><dd>{names(segment.travellerIds)}</dd></div>}
          </dl>
          <p className={styles.zone}>Times shown in India time.</p>
          {segment.notes && <p className={styles.notes}>{segment.notes}</p>}
          <div className={styles.cardActions}>
            <button type="button" className="button secondary" aria-label={`Edit ${segment.title}`} onClick={() => { setRemoving(null); setEditor(segment); }}>Edit</button>
            <button type="button" className="button destructive" aria-label={`Remove ${segment.title}`} onClick={() => { setEditor(null); setRemoveError(""); setRemoving(segment); }}>Remove</button>
          </div>
        </li>;
      })}
    </ul>}
    {editor && <TravelForm
      key={editor === "create" ? "create" : editor.id}
      tripId={tripId}
      segment={editor === "create" ? undefined : editor}
      participants={participants}
      participantError={participantError}
      onRetryParticipants={() => void load()}
      onClose={() => setEditor(null)}
      onSaved={(segment) => {
        setSegments((current) => sortSegments([...(current ?? []).filter((item) => item.id !== segment.id), segment]));
        setLoadError("");
        setEditor(null);
        void load();
      }}
    />}
    {removing && <Dialog className={styles.dialog} title="Remove this journey?" onClose={() => setRemoving(null)} busy={removingBusy}>
      <p>Remove “{removing.title}” from the trip. Accepted members will no longer see it.</p>
      {removeError && <Notice>{removeError}</Notice>}
      <div className={`dialog-actions ${styles.actions}`}>
        <button type="button" className="button secondary" disabled={removingBusy} onClick={() => setRemoving(null)}>Keep journey</button>
        <button type="button" className="button destructive" disabled={removingBusy} onClick={() => void remove()}>{removingBusy ? <Busy text="Removing…" /> : "Remove journey"}</button>
      </div>
    </Dialog>}
  </section>;
}
