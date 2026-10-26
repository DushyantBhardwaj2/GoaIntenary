"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, Plus, UserPlus } from "lucide-react";
import { api, core, type Ledger, type Trip } from "@/lib/client";
import { amountInput, money, parseINR } from "@/lib/money";
import { useSession } from "./session";
import { Busy, Dialog, Notice } from "./ui";
import type { Settlement } from "./budget";
import styles from "./expense-workspace.module.css";

export function GuestForm({ trip, onClose, onSaved }: { trip: Trip; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const attempt = useRef<{ name: string; key: string } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const displayName = name.trim();
      if (!displayName) throw new Error("Enter a name your group recognises.");
      if (!attempt.current || attempt.current.name !== displayName) attempt.current = { name: displayName, key: crypto.randomUUID() };
      await api(`${core}/trips/${trip.id}/expense-participants`, { method: "POST", headers: { "Idempotency-Key": attempt.current.key }, body: JSON.stringify({ displayName }) });
      await onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to add a guest."); }
    finally { setBusy(false); }
  }
  return <Dialog title="Add a named guest" className={styles.financeDialog} busy={busy} onClose={onClose}><form className={`premium-form ${styles.financeForm}`} onSubmit={submit}><div className={styles.formNote}><UserPlus size={20} /><p>No account needed. A guest can pay or share bills, but won’t get access to the trip.</p></div><label>Guest name<input autoFocus required maxLength={80} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Ananya" /></label><p className="helper-text">Use a distinct name. This doesn’t create an account or send an invitation.</p>{error && <Notice>{error}</Notice>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" type="submit" disabled={busy}>{busy ? <Busy /> : <><Plus size={16} />Add guest</>}</button></div></form></Dialog>;
}

export function RepaymentForm({ trip, ledger, initial, onClose, onSaved }: { trip: Trip; ledger: Ledger; initial: Settlement; onClose: () => void; onSaved: () => Promise<void> }) {
  const { user } = useSession();
  const debtors = ledger.balances.filter(row => row.balancePaise < 0 && (trip.role === "organiser" || row.participantId === user?.id));
  const creditors = ledger.balances.filter(row => row.balancePaise > 0);
  const [from, setFrom] = useState(initial.fromParticipantId), [to, setTo] = useState(initial.toParticipantId);
  const [amount, setAmount] = useState(amountInput(initial.amountPaise));
  const [date, setDate] = useState(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const [note, setNote] = useState(""), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const limit = Math.min(-(debtors.find(row => row.participantId === from)?.balancePaise ?? 0), creditors.find(row => row.participantId === to)?.balancePaise ?? 0);
  const name = (id: string) => ledger.participants.find(person => person.id === id)?.displayName ?? "Traveller";
  function changePeople(nextFrom: string, nextTo: string) {
    setFrom(nextFrom); setTo(nextTo); setConfirmed(false);
    setAmount(amountInput(Math.min(-(debtors.find(row => row.participantId === nextFrom)?.balancePaise ?? 0), creditors.find(row => row.participantId === nextTo)?.balancePaise ?? 0)));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (!confirmed) throw new Error("Confirm the payment happened outside the app.");
      const amountPaise = parseINR(amount, false);
      if (amountPaise > limit) throw new Error("The amount exceeds the outstanding balance. Refresh the balances and try again.");
      const payload = JSON.stringify({ fromParticipantId: from, toParticipantId: to, amountPaise, date, note: note.trim() });
      if (!attempt.current || attempt.current.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
      await api(`${core}/trips/${trip.id}/repayments`, { method: "POST", headers: { "Idempotency-Key": attempt.current.key }, body: payload });
      await onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to record the repayment."); }
    finally { setBusy(false); }
  }
  return <Dialog title="Record a payment" className={styles.financeDialog} busy={busy} onClose={onClose}><form className={`premium-form ${styles.financeForm}`} onSubmit={submit}>
    <div className={styles.paymentPreview}><strong>{name(from)}</strong><ArrowRight size={18} /><strong>{name(to)}</strong></div><p className="form-intro">Record a payment after it happens by UPI, cash or another method. Goa Together doesn’t transfer money.</p>
    <div className="form-two"><label>Who paid?<select required value={from} onChange={event => changePeople(event.target.value, to)}>{debtors.map(row => <option key={row.participantId} value={row.participantId}>{row.displayName}</option>)}</select></label><label>Who received it?<select required value={to} onChange={event => changePeople(from, event.target.value)}>{creditors.map(row => <option key={row.participantId} value={row.participantId}>{row.displayName}</option>)}</select></label></div>
    <div className="form-two"><label>Amount in INR<input autoFocus required inputMode="decimal" value={amount} onChange={event => { setAmount(event.target.value); setConfirmed(false); }} /></label><label>Payment date<input required type="date" value={date} onChange={event => { setDate(event.target.value); setConfirmed(false); }} /></label></div>
    <p className="helper-text">Up to {money(limit)} between these people. You can record a smaller amount for a partial payment.</p><label>Note (optional)<input maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="UPI, cash or a useful reference" /></label>
    <label className={styles.confirmation}><input required type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>This payment was already made outside Goa Together.</span></label>
    {error && <Notice>{error}</Notice>}<div className="dialog-actions"><button className="button secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" type="submit" disabled={busy || limit <= 0}>{busy ? <Busy /> : <><Check size={16} />Save payment record</>}</button></div>
  </form></Dialog>;
}
