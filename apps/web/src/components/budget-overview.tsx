import { Edit3, Wallet } from "lucide-react";
import type { Budget, Trip } from "@/lib/client";
import { money } from "@/lib/money";
import styles from "./expense-workspace.module.css";

export function BudgetOverview({ data, trip, onEdit }: { data: Budget; trip: Trip; onEdit: () => void }) {
  const remainingOver = data.remainingPaise != null && data.remainingPaise < 0;
  const forecastOver = data.forecastRemainingPaise != null && data.forecastRemainingPaise < 0;
  return <section className={styles.budgetView} aria-label="Budget forecast">
    <div className={styles.panelHeading} style={{ flexWrap: "wrap" }}><div><span className={styles.kicker}>THE BIGGER PICTURE</span><h3>Keep the trip on budget</h3></div>{trip.role === "organiser" && <button type="button" className={styles.smallButton} onClick={onEdit}><Edit3 size={14} />{data.budgetPaise == null ? "Set budget" : "Edit budget"}</button>}</div>
    <div className={styles.budgetFigures}>
      <div style={{ gridColumn: "1 / -1" }}><span>Trip budget</span><strong>{money(data.budgetPaise)}</strong></div>
      <div><span>{remainingOver ? "Over budget" : "Remaining"}</span><strong className={remainingOver ? styles.negative : ""}>{money(data.remainingPaise == null ? null : Math.abs(data.remainingPaise))}</strong></div>
      <div><span>{forecastOver ? "Forecast over budget" : "Forecast remaining"}</span><strong className={forecastOver ? styles.negative : ""}>{money(data.forecastRemainingPaise == null ? null : Math.abs(data.forecastRemainingPaise))}</strong></div>
    </div>
    {data.budgetPaise != null && <><div className={styles.budgetTrack}><span style={{ width: `${Math.min(100, data.actualTotalPaise / Math.max(1, data.budgetPaise) * 100)}%` }} /></div><p className={styles.muted}>{money(data.actualTotalPaise)} recorded spending of {money(data.budgetPaise)} budget.</p></>}
    <div className={styles.forecast}><Wallet size={21} /><div><strong>{money(data.plannedTotalPaise)} planned in your itinerary</strong><p>Estimates help you plan. They never add to paid spending or anyone’s balance.</p></div></div>
    <h4 className={styles.tableTitle}>Spending by category</h4>
    <p className={styles.muted}>A limit shows on that category when one is set. Paid spending above it is marked over limit. Caps do not change bills or balances.</p>
    <div className={styles.categoryHeader}><span>Category</span><span>Planned</span><span>Paid</span></div>
    {data.categoryTotals.map((row) => {
      const over = row.limitPaise != null && row.actualPaise > row.limitPaise;
      return <div className={styles.categoryRow} key={row.category}>
        <span>
          {row.category}
          {row.limitPaise != null && <span style={{ display: "block" }}>Limit {money(row.limitPaise)}</span>}
          {over && <span className={styles.negative} style={{ display: "block", fontWeight: 600 }}>Over limit</span>}
        </span>
        <span>{money(row.plannedPaise)}</span>
        <strong>{money(row.actualPaise)}</strong>
      </div>;
    })}
    <details className={styles.planningAverage}><summary>Planning averages for {trip.travellerCount ?? 1} travellers</summary><div><span>Itinerary estimate per person<strong>{money(data.estimatedPerPersonPaise)}</strong></span><span>Recorded spending average<strong>{money(data.actualPerPersonPaise)}</strong></span></div><p>These use your declared trip headcount. Actual bill shares come from the selected people on each expense.</p></details>
  </section>;
}
