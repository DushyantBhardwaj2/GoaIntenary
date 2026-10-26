"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Phone, Plus } from "lucide-react";
import { api, core } from "@/lib/client";
import type { Contact, ContactInput, ContactRole } from "@/lib/trip-planning-types";
import { Busy, Dialog, Notice } from "./ui";
import styles from "./contacts.module.css";

const roles: { value: ContactRole; label: string; hint: string }[] = [
  { value: "organiser", label: "Organiser", hint: "Someone to call about the trip. Saving this card does not change who can manage the trip." },
  { value: "hotel", label: "Hotel", hint: "Front desk, host, or the property itself." },
  { value: "driver", label: "Driver", hint: "Whoever is collecting the group." },
  { value: "rental", label: "Rental", hint: "Scooter, car, or gear hire." },
  { value: "activity_provider", label: "Activity provider", hint: "The operator for something you have planned." },
];

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function callHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return `tel:${phone.includes("+") ? "+" : ""}${digits}`;
}

function optionalId(value: string, label: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!uuidPattern.test(trimmed)) throw new Error(`${label} must be an id from this trip, or leave it blank.`);
  return trimmed.toLowerCase();
}

function PhoneLine({ phone }: { phone: string }) {
  const href = callHref(phone);
  if (!phone.trim()) return <p className={styles.phoneText}>No number yet</p>;
  if (!href) return <p className={styles.phoneText}>{phone}</p>;
  return <a className={styles.phoneLink} href={href}><Phone size={16} aria-hidden="true" />{phone}</a>;
}

function ContactForm({ tripId, contact, initialRole, onClose, onSaved }: { tripId: string; contact?: Contact; initialRole: ContactRole; onClose: () => void; onSaved: () => Promise<void> }) {
  const [role, setRole] = useState<ContactRole>(contact?.role ?? initialRole);
  const [name, setName] = useState(contact?.name ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [note, setNote] = useState(contact?.note ?? "");
  const [stayId, setStayId] = useState(contact?.stayId ?? "");
  const [activityId, setActivityId] = useState(contact?.activityId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ payload: string; key: string } | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("Give the contact a name.");
      const body: ContactInput = {
        role,
        name: trimmedName,
        phone: phone.trim(),
        note: note.trim(),
        stayId: optionalId(stayId, "Stay id"),
        activityId: optionalId(activityId, "Activity id"),
      };
      const payload = JSON.stringify(body);
      if (!attempt.current || attempt.current.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
      await api(`${core}/trips/${tripId}/contacts${contact ? `/${contact.id}` : ""}`, {
        method: contact ? "PATCH" : "POST",
        headers: contact ? {} : { "Idempotency-Key": attempt.current.key },
        body: payload,
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save this phone card.");
    } finally {
      setBusy(false);
    }
  };

  return <Dialog title={contact ? "Edit this phone card" : "Add a phone card"} onClose={onClose} busy={busy}>
    <form className={`premium-form ${styles.form}`} onSubmit={submit} autoComplete="off">
      <p className="helper-text">Numbers with at least seven digits can be tapped to call. This page stays on the trip.</p>
      <label>Role
        <select value={role} onChange={(event) => setRole(event.target.value as ContactRole)}>
          {roles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      {role === "organiser" && <p className="helper-text">An organiser card is only a phone number. It does not change who can manage the trip.</p>}
      <label>Name
        <input autoFocus required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="Front desk, Ravi, the rental shop" />
      </label>
      <label>Phone <span>(optional)</span>
        <input type="tel" inputMode="tel" autoComplete="tel" maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+91 832 000 0000" />
      </label>
      <p className="helper-text">Seven digits or more become a call link. A shorter note stays as text.</p>
      <label>Note <span>(optional)</span>
        <textarea rows={3} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Ask for the garden room" />
      </label>
      <label>Stay id <span>(optional)</span>
        <input maxLength={80} spellCheck={false} value={stayId} onChange={(event) => setStayId(event.target.value)} placeholder="Leave blank if it is not tied to a stay" />
      </label>
      <label>Activity id <span>(optional)</span>
        <input maxLength={80} spellCheck={false} value={activityId} onChange={(event) => setActivityId(event.target.value)} placeholder="Leave blank if it is not tied to an activity" />
      </label>
      <p className="helper-text">Stay and activity ids are optional. Use one from this trip, or leave both blank.</p>
      {error && <Notice>{error}</Notice>}
      <div className="dialog-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="button primary" type="submit" disabled={busy}>{busy ? <Busy text="Saving…" /> : "Save phone card"}</button>
      </div>
    </form>
  </Dialog>;
}

export function ContactsPanel({ tripId }: { tripId: string }) {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<{ contact?: Contact; role: ContactRole } | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const seenTrip = useRef(tripId);
  const generation = useRef(0);
  if (seenTrip.current !== tripId) {
    seenTrip.current = tripId;
    setContacts(null);
    setError("");
    setLoading(true);
  }

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await api<{ contacts: Contact[] }>(`${core}/trips/${tripId}/contacts`);
      if (generation.current !== current) return;
      setContacts(result.contacts);
    } catch (err) {
      if (generation.current !== current) return;
      setError(err instanceof Error ? err.message : "Unable to load phone cards.");
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [tripId]);

  useEffect(() => { void load(); }, [load]);

  const grouped = roles.map((role) => ({
    ...role,
    cards: (contacts ?? []).filter((contact) => contact.role === role.value).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
  }));

  const removeCard = async () => {
    if (!removing) return;
    setBusy(true);
    setActionError("");
    try {
      await api(`${core}/trips/${tripId}/contacts/${removing.id}`, { method: "DELETE" });
      setRemoving(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to remove this phone card.");
    } finally {
      setBusy(false);
    }
  };

  return <section className={styles.panel} aria-label="Phone cards" aria-busy={loading}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <span className={styles.kicker}><Phone size={15} aria-hidden="true" /> NUMBERS FOR THE TRIP</span>
        <h2>Phone cards</h2>
        <p>Organiser, hotel, driver, rental, and activity provider. Tap a long enough number to call without leaving the trip.</p>
      </div>
      <button className="button primary" type="button" disabled={contacts === null} onClick={() => { setRemoving(null); setDraft({ role: "hotel" }); }}>
        <Plus size={17} aria-hidden="true" />Add phone card
      </button>
    </header>
    {error && <Notice>{error} <button type="button" className="text-button" onClick={() => void load()}>Retry</button></Notice>}
    {loading && contacts === null ? <div className={styles.loading}><Busy text="Finding phone cards…" /></div> : null}
    {contacts && contacts.length === 0 && <p className={styles.emptyLead}>No phone cards yet. Add an organiser, hotel, driver, rental, or activity provider when you have a number to keep.</p>}
    {contacts && <div className={styles.roles}>
      {grouped.map((role) => <section key={role.value} className={styles.role} aria-labelledby={`contact-role-${role.value}`}>
        <div className={styles.roleHead}>
          <h3 id={`contact-role-${role.value}`}>{role.label}</h3>
          <button className="button secondary" type="button" aria-label={`Add ${role.label} card`} onClick={() => { setRemoving(null); setDraft({ role: role.value }); }}>Add</button>
        </div>
        <p className="helper-text">{role.hint}</p>
        {role.cards.length === 0 ? <p className={styles.none}>No card yet</p> : <ul className={styles.cards}>
          {role.cards.map((contact) => <li key={contact.id}>
            <article className={styles.card} data-role={contact.role}>
              <h4>{contact.name}</h4>
              <PhoneLine phone={contact.phone} />
              {contact.note ? <p className={styles.note}>{contact.note}</p> : null}
              {contact.stayId ? <p className={styles.meta}>Stay <span>{contact.stayId}</span></p> : null}
              {contact.activityId ? <p className={styles.meta}>Activity <span>{contact.activityId}</span></p> : null}
              <div className={styles.actions}>
                <button className="button secondary" type="button" aria-label={`Edit ${contact.name}`} onClick={() => { setRemoving(null); setDraft({ contact, role: contact.role }); }}>Edit</button>
                <button className="button secondary" type="button" aria-label={`Remove ${contact.name}`} onClick={() => { setDraft(null); setActionError(""); setRemoving(contact); }}>Remove</button>
              </div>
            </article>
          </li>)}
        </ul>}
      </section>)}
    </div>}
    {draft && <ContactForm tripId={tripId} contact={draft.contact} initialRole={draft.role} onClose={() => setDraft(null)} onSaved={load} />}
    {removing && <Dialog title="Remove this phone card?" onClose={() => { if (!busy) setRemoving(null); }} busy={busy}>
      <p>This hides {removing.name} from the trip. It does not place a call.</p>
      {actionError && <Notice>{actionError} <button type="button" className="text-button" onClick={() => void removeCard()}>Retry</button></Notice>}
      <div className="dialog-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={() => setRemoving(null)}>Keep card</button>
        <button className="button primary" type="button" disabled={busy} onClick={() => void removeCard()}>{busy ? <Busy text="Removing…" /> : "Remove card"}</button>
      </div>
    </Dialog>}
  </section>;
}
