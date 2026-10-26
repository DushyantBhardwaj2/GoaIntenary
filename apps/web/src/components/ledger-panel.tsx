"use client";

import { useState } from "react";
import { ArrowRight, ArrowRightLeft, Check, ChevronRight, Plus, Trash2, Users } from "lucide-react";
import { api, core, type ExpenseParticipant, type Ledger, type Repayment, type Trip } from "@/lib/client";
import { money } from "@/lib/money";
import { useSession } from "./session";
import { Busy, Dialog, Notice } from "./ui";
import type { Settlement } from "./budget";
import styles from "./expense-workspace.module.css";

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join("").toLocaleUpperCase();

export function LedgerPanel({ trip, ledger, onSaved, onAddGuest, onViewSettlements }: { trip: Trip; ledger: Ledger; onSaved: () => Promise<void>; onAddGuest: () => void; onViewSettlements: () => void }) {
  const { user } = useSession();
  const [archiving, setArchiving] = useState<ExpenseParticipant | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const people = new Map(ledger.participants.map(person => [person.id, person]));
  const active = ledger.participants.filter(person => person.active);
  async function archiveGuest() {
    if (!archiving) return;
    setBusy(true); setError("");
    try { await api(`${core}/trips/${trip.id}/expense-participants/${archiving.id}`, { method: "DELETE" }); await onSaved(); setArchiving(null); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to archive this guest."); }
    finally { setBusy(false); }
  }
  return <aside className={styles.sidebar} aria-label="Group balances and people">
    <section className={styles.balances}>
      <div className={styles.panelHeading}><div><h3>Group balances</h3><p>Who owes what, at a glance.</p></div><span className={styles.peopleCount}><Users size={15} />{active.length}</span></div>
      <div className={styles.balanceList}>{ledger.balances.map(row => {
        const person = people.get(row.participantId);
        return <details key={row.participantId} className={styles.personBalance}>
          <summary><span className={styles.avatar} data-guest={person?.kind === "guest"}>{initials(row.displayName)}</span><span className={styles.personName}><strong>{row.displayName}{row.participantId === user?.id && <em>you</em>}</strong><small>{person?.kind === "guest" ? "Guest" : "Member"}{!person?.active ? " · historical" : ""}</small></span><span className={`${styles.personAmount} ${row.balancePaise < 0 ? styles.negative : row.balancePaise > 0 ? styles.positive : styles.neutral}`}><strong>{money(Math.abs(row.balancePaise))}</strong><small>{row.balancePaise > 0 ? "gets back" : row.balancePaise < 0 ? "owes" : "settled"}</small></span></summary>
          <dl className={styles.balanceBreakdown}><div><dt>Paid for shared bills</dt><dd>{money(row.paidPaise)}</dd></div><div><dt>Allocated share</dt><dd>{money(row.sharePaise)}</dd></div><div><dt>Repayments sent</dt><dd>{money(row.sentPaise)}</dd></div><div><dt>Repayments received</dt><dd>{money(row.receivedPaise)}</dd></div></dl>
        </details>;
      })}</div>
      {ledger.settlements.length > 0 ? <button type="button" className={styles.balanceLink} onClick={onViewSettlements}><ArrowRightLeft size={15} />See how to settle up<ChevronRight size={15} /></button> : <div className={styles.balancedNote}><Check size={16} />All allocated bills are balanced</div>}
      {trip.role === "organiser" && <button type="button" className={styles.addPerson} onClick={onAddGuest}><Plus size={16} />Add a named guest</button>}
      <p className={styles.guestNote}>Guests can share a bill without signing in. Adding a guest does not give them access to the trip, and it does not change a balance until a bill includes them.</p><details className={styles.peopleHelp}><summary>About members & guests</summary><p>Members join through trip invitations. A guest and a joined member stay separate until you explicitly correct their bills.</p>{trip.role === "organiser" && active.some(person => person.kind === "guest") && <><h4>Manage named guests</h4>{active.filter(person => person.kind === "guest").map(person => <div className={styles.manageGuest} key={person.id}><span>{person.displayName}</span><button type="button" className={styles.iconButton} aria-label={`Archive guest ${person.displayName}`} onClick={() => { setError(""); setArchiving(person); }}><Trash2 size={14} /></button></div>)}</>}</details>
    </section>
    <div className={styles.sidebarNote}><span className={styles.kicker}>A LITTLE LESS MATH</span><p>More time for the good stuff.</p><small>Balances use selected bill shares and recorded repayments. Trip headcount never decides a split.</small></div>
    {archiving && <Dialog title="Archive this guest?" className={styles.financeDialog} busy={busy} onClose={() => setArchiving(null)}><p>{archiving.displayName} will no longer appear in new bills. Existing shares, payments and balances stay in the ledger.</p>{error && <Notice>{error}</Notice>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setArchiving(null)}>Cancel</button><button type="button" className="button destructive" disabled={busy} onClick={() => void archiveGuest()}>{busy ? <Busy /> : "Archive guest"}</button></div></Dialog>}
  </aside>;
}

export function SettlementPanel({ trip, ledger, onSaved, onSettle }: { trip: Trip; ledger: Ledger; onSaved: () => Promise<void>; onSettle: (settlement: Settlement) => void }) {
  const { user } = useSession();
  const [removing, setRemoving] = useState<Repayment | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const name = (id: string) => ledger.participants.find(person => person.id === id)?.displayName ?? "Traveller";
  async function removeRepayment() {
    if (!removing) return;
    setBusy(true); setError("");
    try { await api(`${core}/trips/${trip.id}/repayments/${removing.id}`, { method: "DELETE" }); await onSaved(); setRemoving(null); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to correct the repayment."); }
    finally { setBusy(false); }
  }
  return <section className={styles.settlementView} aria-label="Settle up and payment history">
    <div className={styles.settlementIntro}><span className={styles.kicker}><ArrowRightLeft size={14} /> SQUARE THINGS UP</span><h3>A simple way to settle</h3><p>Pay your friend by UPI, cash or your usual method, then record it here. No money moves through Goa Together.</p></div>
    {ledger.settlements.length ? <div className={styles.settlementList}>{ledger.settlements.map(row => {
      const canRecord = trip.role === "organiser" || row.fromParticipantId === user?.id;
      return <article className={styles.settlementCard} key={`${row.fromParticipantId}:${row.toParticipantId}`}>
        <div className={styles.paymentPeople}><span className={styles.avatar}>{initials(name(row.fromParticipantId))}</span><span><strong>{name(row.fromParticipantId)}</strong><small>pays {name(row.toParticipantId)}</small></span><ArrowRight size={18} /><span className={`${styles.avatar} ${styles.creditorAvatar}`}>{initials(name(row.toParticipantId))}</span></div>
        <strong className={styles.paymentAmount}>{money(row.amountPaise)}</strong>
        {canRecord ? <button type="button" className={styles.smallButton} onClick={() => onSettle(row)}>Record payment<ArrowRight size={14} /></button> : <small className={styles.muted}>Payer or organiser can record</small>}
      </article>;
    })}<p className={styles.settlementHelp}>Suggestions combine balances across bills. Recording a partial payment updates what remains.</p></div> : <div className={styles.empty}><span className={styles.emptyIcon}><Check size={28} /></span><h3>All square.</h3><p>{ledger.unallocatedTotalPaise > 0 ? "Allocated bills are balanced. Expenses without a split haven’t been included yet." : "There’s nothing to settle on the bills shared so far."}</p></div>}
    <div className={styles.history}><div className={styles.panelHeading}><h3>Payment history</h3><span className={styles.countBadge}>{ledger.repayments.length}</span></div><p className={styles.muted}>Recorded repayments reduce balances. They don’t add to trip spending.</p>{ledger.repayments.length ? [...ledger.repayments].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).map(row => <article className={styles.historyRow} key={row.id}><span className={styles.historyCheck}><Check size={15} /></span><div><strong>{name(row.fromParticipantId)} paid {name(row.toParticipantId)}</strong><small>{row.date}{row.note ? ` · ${row.note}` : ""}</small></div><strong>{money(row.amountPaise)}</strong>{(trip.role === "organiser" || row.createdBy === user?.id) && <button type="button" className={styles.iconButton} aria-label={`Remove repayment from ${name(row.fromParticipantId)} to ${name(row.toParticipantId)} on ${row.date}`} onClick={() => { setError(""); setRemoving(row); }}><Trash2 size={15} /></button>}</article>) : <p className={styles.noHistory}>No payments recorded yet.</p>}</div>
    {removing && <Dialog title="Remove this payment record?" className={styles.financeDialog} busy={busy} onClose={() => setRemoving(null)}><p>This removes the repayment from current balances and keeps its audit record. It does not refund or move money.</p>{error && <Notice>{error}</Notice>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setRemoving(null)}>Cancel</button><button type="button" className="button destructive" disabled={busy} onClick={() => void removeRepayment()}>{busy ? <Busy /> : "Remove payment record"}</button></div></Dialog>}
  </section>;
}
