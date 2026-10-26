"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowDownLeft, ArrowRightLeft, Plus, Receipt, RefreshCw, Users, Wallet } from "lucide-react";
import { api, core, expenseCategories, type Budget, type Expense, type ExpenseCategory, type Ledger, type Trip } from "@/lib/client";
import { amountInput, money, parseINR } from "@/lib/money";
import { useSession } from "./session";
import { Busy, Dialog, Notice } from "./ui";
import { ExpenseForm } from "./expense-form";
import { ExpenseFeed } from "./expense-feed";
import { BudgetOverview } from "./budget-overview";
import { LedgerPanel, SettlementPanel } from "./ledger-panel";
import { GuestForm, RepaymentForm } from "./settlement-forms";
import styles from "./expense-workspace.module.css";

export type Settlement = Ledger["settlements"][number];
type View = "expenses" | "settle" | "budget";
const limitLabels: Record<ExpenseCategory, string> = {
  accommodation: "Accommodation", transport: "Transport", food: "Food", activities: "Activities", shopping: "Shopping", other: "Other",
};

export function BudgetPanel({ trip, onChanged }: { trip: Trip; onChanged: () => Promise<void> }) {
  const { user } = useSession();
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [data, setData] = useState<Budget | null>(null);
  const [view, setView] = useState<View>("expenses");
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [dialogError, setDialogError] = useState("");
  const [expense, setExpense] = useState<Expense | "new" | null>(null);
  const [removing, setRemoving] = useState<Expense | null>(null);
  const [correction, setCorrection] = useState(false), [addingGuest, setAddingGuest] = useState(false);
  const [paying, setPaying] = useState<Settlement | null>(null);
  const [busy, setBusy] = useState(false), [editingBudget, setEditingBudget] = useState(false), [budgetInput, setBudgetInput] = useState("");
  const [editingLimits, setEditingLimits] = useState(false), [limitRetry, setLimitRetry] = useState(false);
  const [limitInputs, setLimitInputs] = useState<Partial<Record<ExpenseCategory, string>>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [budget, nextLedger] = await Promise.all([api<Budget>(`${core}/trips/${trip.id}/budget`), api<Ledger>(`${core}/trips/${trip.id}/ledger`)]);
      setData(budget); setLedger(nextLedger); setError("");
    } finally { setLoading(false); }
  }, [trip.id, trip.budgetPaise, trip.travellerCount]);
  const refresh = useCallback(async () => {
    try { await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load expenses. Please retry."); }
  }, [load]);
  useEffect(() => { void refresh(); }, [refresh]);

  const myBalance = ledger?.balances.find(row => row.participantId === user?.id);
  const balance = myBalance?.balancePaise ?? 0;
  const activePeople = ledger?.participants.filter(person => person.active) ?? [];
  const availableSettlement = ledger?.settlements.find(row => trip.role === "organiser" || row.fromParticipantId === user?.id);
  const hasRepayments = Boolean(ledger?.repayments.length);
  function settleUp() { if (availableSettlement) setPaying(availableSettlement); else setView("settle"); }
  async function editBudget(event: FormEvent) {
    event.preventDefault(); setBusy(true); setDialogError("");
    try {
      await api(`${core}/trips/${trip.id}`, { method: "PATCH", body: JSON.stringify({ budgetPaise: budgetInput.trim() ? parseINR(budgetInput) : null }) });
      await load(); await onChanged(); setEditingBudget(false);
    } catch (err) { setDialogError(err instanceof Error ? err.message : "Unable to update the budget."); }
    finally { setBusy(false); }
  }
  function openLimits() {
    if (!data || busy) return;
    const next: Partial<Record<ExpenseCategory, string>> = {};
    for (const category of expenseCategories) next[category] = amountInput(data.categoryTotals.find((row) => row.category === category)?.limitPaise);
    setLimitInputs(next); setDialogError(""); setLimitRetry(false); setEditingBudget(false); setEditingLimits(true);
  }
  async function saveLimits(event?: FormEvent) {
    event?.preventDefault(); setBusy(true); setDialogError(""); setLimitRetry(false);
    try {
      const limits: { category: ExpenseCategory; limitPaise: number }[] = [];
      for (const category of expenseCategories) {
        const raw = (limitInputs[category] ?? "").trim();
        if (!raw) continue;
        try { limits.push({ category, limitPaise: parseINR(raw) }); }
        catch (err) { setDialogError(`${limitLabels[category]}: ${err instanceof Error ? err.message : "Enter a valid amount."}`); return; }
      }
      if (!limits.length) { setDialogError("Enter a whole-rupee cap for at least one category, or cancel to leave the caps unchanged."); return; }
      await api(`${core}/trips/${trip.id}/budget/category-limits`, { method: "PUT", body: JSON.stringify({ limits }) });
      await load(); setEditingLimits(false);
    } catch (err) { setLimitRetry(true); setDialogError(err instanceof Error ? err.message : "Unable to save category limits."); }
    finally { setBusy(false); }
  }
  async function removeExpense() {
    if (!removing) return;
    setBusy(true); setDialogError("");
    try {
      await api(`${core}/trips/${trip.id}/expenses/${removing.id}${correction ? "?acknowledgeSettlementChange=true" : ""}`, { method: "DELETE" });
      await load(); setRemoving(null);
    } catch (err) { setDialogError(err instanceof Error ? err.message : "Unable to remove the expense."); }
    finally { setBusy(false); }
  }
  return <section className={styles.workspace} aria-label="Trip expense workspace">
    <header className={styles.header}>
      <div className={styles.heading}><span className={styles.kicker}><Wallet size={15} /> THE GROUP WALLET</span><h2>Trip expenses</h2><p>Shared moments. Fair shares. Everything in one place.</p></div>
      <div className={styles.headerActions}>
        <button type="button" className={styles.iconButton} onClick={() => void refresh()} disabled={loading} aria-label="Refresh expenses and balances"><RefreshCw size={18} className={loading ? "spinner" : ""} /></button>
        <button type="button" className={styles.secondaryButton} onClick={settleUp} disabled={!ledger}><ArrowRightLeft size={16} />Settle up</button>
        <button type="button" className={styles.primaryButton} onClick={() => setExpense("new")} disabled={!ledger}><Plus size={18} />Add expense</button>
      </div>
    </header>
    {error && <Notice>{error} <button type="button" className="text-button" onClick={() => void refresh()}>Retry</button></Notice>}
    {loading && !data ? <div className={styles.loading}><Busy text="Opening the group wallet…" /></div> : data && ledger && <>
      <div className={styles.summaryGrid}>
        <div className={`${styles.stat} ${styles.personalStat}`}><div><span>{balance > 0 ? "You are owed" : balance < 0 ? "You owe" : "Your balance"}</span><ArrowRightLeft size={18} /></div><strong>{money(Math.abs(balance))}</strong><small>{balance === 0 ? "You’re all settled on allocated bills" : balance > 0 ? "After your shares and recorded repayments" : "Your outstanding share after repayments"}</small></div>
        <div className={styles.stat}><div><span>Group spending</span><Receipt size={18} /></div><strong>{money(data.actualTotalPaise)}</strong><small>{data.expenses.length} {data.expenses.length === 1 ? "expense" : "expenses"} · repayments excluded</small></div>
        <div className={styles.stat}><div><span>Your total share</span><ArrowDownLeft size={18} /></div><strong>{money(myBalance?.sharePaise ?? 0)}</strong><small>Only bills you were selected to share</small></div>
      </div>
      <div className={styles.workspaceBar}>
        <nav className={styles.viewNav} aria-label="Expense views">{([{ id: "expenses", label: "Expenses", count: data.expenses.length }, { id: "settle", label: "Settle up", count: ledger.settlements.length }, { id: "budget", label: "Budget" }] as const).map(item => <button type="button" key={item.id} aria-pressed={view === item.id} aria-controls="expense-workspace-view" onClick={() => setView(item.id)}>{item.label}{"count" in item && <span>{item.count}</span>}</button>)}</nav>
        <span className={styles.currencyNote}><Users size={14} />{activePeople.length} {activePeople.length === 1 ? "traveller" : "travellers"}<i />INR ₹</span>
      </div>
      {ledger.unallocatedTotalPaise > 0 && <div className={styles.unallocated}><Receipt size={17} /><p><strong>{money(ledger.unallocatedTotalPaise)} hasn’t been split yet.</strong> Choose the people on those bills to include them in balances.</p><button type="button" className={styles.textButton} onClick={() => setView("expenses")}>View expenses</button></div>}
      <div className={styles.columns}>
        <div className={styles.mainColumn} id="expense-workspace-view">
          {view === "expenses" && <ExpenseFeed expenses={data.expenses} userId={user?.id} organiser={trip.role === "organiser"} hasRepayments={hasRepayments} onAdd={() => setExpense("new")} onEdit={setExpense} onDelete={item => { setDialogError(""); setCorrection(false); setRemoving(item); }} />}
          {view === "settle" && <SettlementPanel trip={trip} ledger={ledger} onSaved={load} onSettle={setPaying} />}
          {view === "budget" && <>
            {trip.role === "organiser" && <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", marginBottom: 12 }}><button type="button" className={styles.smallButton} onClick={openLimits} disabled={busy}>Set category limits</button></div>}
            <BudgetOverview data={data} trip={trip} onEdit={() => { setDialogError(""); setLimitRetry(false); setEditingLimits(false); setBudgetInput(amountInput(data.budgetPaise)); setEditingBudget(true); }} />
          </>}
        </div>
        <LedgerPanel trip={trip} ledger={ledger} onSaved={load} onAddGuest={() => setAddingGuest(true)} onViewSettlements={() => setView("settle")} />
      </div>
    </>}
    {expense && ledger && <ExpenseForm trip={trip} participants={ledger.participants} hasRepayments={hasRepayments} expense={expense === "new" ? undefined : expense} onClose={() => setExpense(null)} onSaved={load} />}
    {addingGuest && <GuestForm trip={trip} onClose={() => setAddingGuest(false)} onSaved={load} />}
    {paying && ledger && <RepaymentForm trip={trip} ledger={ledger} initial={paying} onClose={() => setPaying(null)} onSaved={load} />}
    {editingBudget && <Dialog title="Trip budget" className={styles.financeDialog} busy={busy} onClose={() => setEditingBudget(false)}><form className={`premium-form ${styles.financeForm}`} onSubmit={editBudget}><label>Whole-trip budget in INR<div className="money-input"><span>₹</span><input autoFocus inputMode="decimal" value={budgetInput} onChange={event => setBudgetInput(event.target.value)} placeholder="20000.00" /></div></label><p className="helper-text">Leave blank to remove the budget. Saved spending and itinerary estimates stay in place.</p>{dialogError && <Notice>{dialogError}</Notice>}<div className="dialog-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => setEditingBudget(false)}>Cancel</button><button className="button primary" disabled={busy} type="submit">{busy ? <Busy /> : "Save budget"}</button></div></form></Dialog>}
    {editingLimits && <Dialog title="Category limits" className={styles.financeDialog} busy={busy} onClose={() => setEditingLimits(false)}><form className={`premium-form ${styles.financeForm}`} onSubmit={saveLimits} aria-busy={busy}><div style={{ display: "grid", gap: 12, maxHeight: "min(52dvh, 420px)", overflowY: "auto" }}>{expenseCategories.map((category, index) => <label key={category}>{limitLabels[category]} cap in INR<div className="money-input"><span aria-hidden="true">₹</span><input autoFocus={index === 0} inputMode="decimal" autoComplete="off" disabled={busy} value={limitInputs[category] ?? ""} onChange={event => setLimitInputs((current) => ({ ...current, [category]: event.target.value }))} placeholder="5000.00" aria-describedby="category-limit-help" /></div></label>)}</div><p id="category-limit-help" className="helper-text">Leave a category blank to keep its current cap. Enter whole rupees, including 0. A cap is a reminder only and does not change bills, shares, or balances.</p>{dialogError && <Notice>{dialogError}{limitRetry && <> <button type="button" className="text-button" disabled={busy} onClick={() => void saveLimits()}>Retry</button></>}</Notice>}<div className="dialog-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => setEditingLimits(false)}>Cancel</button><button className="button primary" disabled={busy} type="submit">{busy ? <Busy text="Saving category limits…" /> : "Save limits"}</button></div></form></Dialog>}
    {removing && <Dialog title="Delete this expense?" className={styles.financeDialog} busy={busy} onClose={() => setRemoving(null)}><p>“{removing.title}” and its shares will leave current spending and balances. No money is moved or refunded.</p>{hasRepayments && <div className="correction-note"><p>Repayments already exist. Their history stays, so this correction can change who owes whom.</p><label className={`checkbox-label ${styles.confirmation}`}><input type="checkbox" checked={correction} onChange={event => setCorrection(event.target.checked)} />I confirm this correction with the group.</label></div>}{dialogError && <Notice>{dialogError}</Notice>}<div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={() => setRemoving(null)}>Keep expense</button><button className="button destructive" disabled={busy || (hasRepayments && !correction)} onClick={() => void removeExpense()}>{busy ? <Busy /> : "Delete expense"}</button></div></Dialog>}
  </section>;
}
