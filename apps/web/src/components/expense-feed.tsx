"use client";

import { useId, useState } from "react";
import { BedDouble, Car, ChevronDown, Coffee, Edit3, Plus, Receipt, Search, ShoppingBag, Sparkles, Trash2, Users, X } from "lucide-react";
import type { Expense } from "@/lib/client";
import { money } from "@/lib/money";
import styles from "./expense-workspace.module.css";

const categoryIcons: Record<string, typeof Receipt> = { accommodation: BedDouble, transport: Car, food: Coffee, activities: Sparkles, shopping: ShoppingBag };
const fullDate = (date: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(`${date}T12:00:00+05:30`));

export function ExpenseFeed({ expenses, userId, organiser, hasRepayments, onAdd, onEdit, onDelete }: {
  expenses: Expense[]; userId?: string; organiser: boolean; hasRepayments: boolean;
  onAdd: () => void; onEdit: (expense: Expense) => void; onDelete: (expense: Expense) => void;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const needle = query.trim().toLocaleLowerCase();
  const filtered = expenses.filter(item =>
    (!needle || [item.title, item.category, item.paidByDisplayName, ...item.shares.map(share => share.displayName)].some(text => text.toLocaleLowerCase().includes(needle))) &&
    (filter === "all" || (filter === "mine" && (item.paidByParticipantId === userId || item.shares.some(share => share.participantId === userId))) || (filter === "unsplit" && item.splitMode === "none"))
  ).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const groups = new Map<string, Expense[]>();
  for (const expense of filtered) {
    const key = expense.date.slice(0, 7), rows = groups.get(key) ?? [];
    rows.push(expense); groups.set(key, rows);
  }
  return <section className={styles.feed} aria-label="Shared expenses">
    <div className={styles.feedToolbar}>
      <div className={styles.searchBox}>
        <label htmlFor={inputId} className={styles.srOnly}>Search expenses by title, category or traveller</label>
        <Search size={17} aria-hidden="true" /><input id={inputId} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search expenses or people" />
        {query && <button type="button" aria-label="Clear expense search" onClick={() => setQuery("")}><X size={16} /></button>}
      </div>
      <label className={styles.filterLabel}><span className={styles.srOnly}>Filter expenses</span><select aria-label="Filter expenses" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All expenses</option><option value="mine">Involving me</option><option value="unsplit">Not split yet</option></select></label>
    </div>
    <div className={styles.feedCaption}><span>{query || filter !== "all" ? `${filtered.length} of ${expenses.length}` : expenses.length} {expenses.length === 1 ? "expense" : "expenses"}</span><span>Most recent first</span></div>
    {!expenses.length ? <div className={styles.empty}>
      <span className={styles.emptyIcon}><Receipt size={27} strokeWidth={1.5} /></span><h3>The first bill starts here.</h3><p>Dinner for four? A taxi for two? Choose who paid and just the people who shared it.</p><button type="button" className={styles.primaryButton} onClick={onAdd}><Plus size={17} />Add your first expense</button><small>Members and named guests can share a bill.</small>
    </div> : !filtered.length ? <div className={styles.empty}><Search size={25} /><h3>No matching expenses</h3><p>Try a different name or show all expenses.</p><button type="button" className={styles.secondaryButton} onClick={() => { setQuery(""); setFilter("all"); }}>Clear filters</button></div> : [...groups].map(([month, items]) => <div key={month}>
      <h3 className={styles.monthHeading}>{new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(`${month}-01T12:00:00+05:30`))}</h3>
      {items.map(item => {
        const Icon = categoryIcons[item.category] ?? Receipt, yourShare = item.shares.find(share => share.participantId === userId);
        const allowed = organiser || item.createdBy === userId, locked = hasRepayments && !organiser;
        return <details className={styles.expense} key={item.id}>
          <summary className={styles.expenseSummary}>
            <time className={styles.dateBadge} dateTime={item.date} aria-label={fullDate(item.date)}><span>{new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "Asia/Kolkata" }).format(new Date(`${item.date}T12:00:00+05:30`))}</span><strong>{Number(item.date.slice(-2))}</strong></time>
            <span className={styles.categoryIcon} data-category={item.category}><Icon size={20} strokeWidth={1.7} /></span>
            <span className={styles.expenseDescription}><strong>{item.title}</strong><span>{item.paidByParticipantId === userId ? "You" : item.paidByDisplayName} paid · {item.splitMode === "none" ? "Not split yet" : `${item.shares.length} ${item.shares.length === 1 ? "person" : "people"} · ${item.splitMode === "equal" ? "equal split" : "custom split"}`}</span></span>
            <span className={styles.expenseAmount}><strong>{money(item.amountPaise)}</strong><small>{item.splitMode === "none" ? "Excluded from balances" : yourShare ? `Your share ${money(yourShare.amountPaise)}` : "You’re not in this split"}</small></span><ChevronDown size={16} className={styles.chevron} aria-hidden="true" />
          </summary>
          <div className={styles.expenseDetail}>
            <div className={styles.detailHeading}><span><Icon size={14} />{item.category} · {fullDate(item.date)}</span><span>Paid by {item.paidByDisplayName}</span></div>
            {item.splitMode === "none" ? <p className={styles.muted}>This expense counts towards spending. Choose its participants to include it in balances.</p> : <><h4><Users size={15} />{item.splitMode === "equal" ? "Shared equally" : "Custom shares"} between {item.shares.length}</h4><ul className={styles.shareList}>{item.shares.map(share => <li key={share.participantId}><span>{share.displayName}{share.participantId === userId ? " (you)" : ""}</span><strong>{money(share.amountPaise)}</strong></li>)}</ul></>}
            {allowed && <div className={styles.expenseActions}><span>{locked ? "Ask the organiser to correct a bill after repayments." : "Saved to this trip"}</span><button type="button" className={styles.smallButton} onClick={() => onEdit(item)} disabled={locked}><Edit3 size={14} />Edit</button><button type="button" className={`${styles.smallButton} ${styles.danger}`} onClick={() => onDelete(item)} disabled={locked}><Trash2 size={14} />Delete</button></div>}
          </div>
        </details>;
      })}
    </div>)}
    {expenses.length > 0 && <div className={styles.feedFooter}><span>Open a bill to see its split or make a correction.</span><button type="button" className={styles.textButton} onClick={onAdd}><Plus size={15} />Add expense</button></div>}
  </section>;
}
