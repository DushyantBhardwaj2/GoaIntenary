"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { BedDouble, CalendarDays, Phone, Plane, UserRound } from "lucide-react";
import { api, core, dateRange, type Budget, type Member, type Region, type Trip } from "@/lib/client";
import { money } from "@/lib/money";
import { tripDays } from "@/lib/planner";
import type { ActivityStatusValue, ContactRole, OverviewActivity, TravelMode, TripOverview as TripOverviewData } from "@/lib/trip-planning-types";
import { StayMap } from "./stay-map";
import { Busy, Notice } from "./ui";
import styles from "./overview.module.css";

const kolkataDateTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const regionLabel: Record<Region, string> = {
  north: "North Goa",
  south: "South Goa",
  central: "Central Goa",
  all: "Goa",
};

const statusLabel: Record<ActivityStatusValue, string> = {
  planned: "Planned",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

const modeLabel: Record<TravelMode, string> = {
  flight: "Flight",
  train: "Train",
  bus: "Bus",
};

const roleLabel: Record<ContactRole, string> = {
  organiser: "Organiser",
  hotel: "Hotel",
  driver: "Driver",
  rental: "Rental",
  activity_provider: "Activity provider",
};

function callHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  return `tel:${phone.includes("+") ? "+" : ""}${digits}`;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return kolkataDateTime.format(date);
}

function activityTime(activity: OverviewActivity): string {
  if (activity.startTime && activity.endTime) return `${activity.startTime}–${activity.endTime}`;
  if (activity.startTime) return activity.startTime;
  if (activity.endTime) return activity.endTime;
  return "Time open";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
  return letters || "?";
}

function shareOfBudget(recorded: number, budget: number | null): { width: number; label: string } | null {
  if (budget == null || budget <= 0) return null;
  const tenths = Math.min(1000, Math.floor((recorded * 1000) / budget));
  const whole = Math.floor(tenths / 10);
  const fraction = tenths % 10;
  const width = whole === 0 && tenths > 0 ? 1 : Math.min(100, whole);
  return { width, label: fraction === 0 ? `${whole}%` : `${whole}.${fraction}%` };
}

function PhoneLine({ phone }: { phone: string }) {
  const href = callHref(phone);
  if (!phone.trim()) return <p className={styles.phoneText}>No number yet</p>;
  if (!href) return <p className={styles.phoneText}>{phone}</p>;
  return <a className={styles.phoneLink} href={href}><Phone size={16} aria-hidden="true" />{phone}</a>;
}

function DashCard({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      {children}
    </section>
  );
}

export function TripOverview({ trip, members, onOpenPlan, onOpenPeople, onOpenBudget }: {
  trip: Trip;
  members: Member[];
  onOpenPlan: () => void;
  onOpenPeople: () => void;
  onOpenBudget: () => void;
}) {
  const headingId = useId();
  const generation = useRef(0);
  const seenTrip = useRef(trip.id);
  const [overview, setOverview] = useState<TripOverviewData | null>(null);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [budgetError, setBudgetError] = useState("");

  if (seenTrip.current !== trip.id) {
    seenTrip.current = trip.id;
    setOverview(null);
    setBudget(null);
    setError("");
    setBudgetError("");
    setLoading(true);
  }

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    setBudgetError("");
    const overviewRequest = api<TripOverviewData>(`${core}/trips/${trip.id}/overview`);
    const budgetRequest = api<Budget>(`${core}/trips/${trip.id}/budget`)
      .then((value) => ({ ok: true as const, value }))
      .catch((err: unknown) => ({ ok: false as const, message: err instanceof Error ? err.message : "Unable to load shared spending." }));
    try {
      const data = await overviewRequest;
      if (generation.current !== current) return;
      setOverview(data);
    } catch (err) {
      if (generation.current !== current) return;
      setOverview(null);
      setError(err instanceof Error ? err.message : "Unable to load today.");
    }
    const spend = await budgetRequest;
    if (generation.current !== current) return;
    if (spend.ok) {
      setBudget(spend.value);
      setBudgetError("");
    } else {
      setBudget(null);
      setBudgetError(spend.message);
    }
    if (generation.current === current) setLoading(false);
  }, [trip.id]);

  useEffect(() => { void load(); }, [load]);

  const accepted = members.filter((member) => member.status === "accepted");
  const pending = members.filter((member) => member.status === "pending");
  const days = tripDays(trip.startDate, trip.endDate).length;
  const spendShare = budget ? shareOfBudget(budget.actualTotalPaise, budget.budgetPaise) : null;
  const mappedStays = (overview?.stays ?? []).filter((stay) => stay.latitude != null && stay.longitude != null);

  return (
    <section className={styles.panel} aria-labelledby={headingId} aria-busy={loading}>
      <header className={styles.header}>
        <p className={styles.kicker}>TODAY IN GOA</p>
        <h2 id={headingId}>Today</h2>
        <p>What is on today’s date in Goa, the next journeys, the stays, and who to call. {dateRange(trip.startDate, trip.endDate)} · {regionLabel[trip.region]} · {days} {days === 1 ? "day" : "days"}.</p>
      </header>
      <div className={styles.actions}>
        <button type="button" className="button coral" onClick={onOpenPlan}><CalendarDays size={16} />Open itinerary</button>
        <button type="button" className="button secondary" onClick={onOpenPeople}>{trip.role === "organiser" ? "Invite a friend" : "Your people"}</button>
      </div>
      {loading && !overview ? <div className={styles.loading} role="status"><Busy text="Loading today…" /></div> : null}
      {!loading && error ? (
        <div className={styles.recovery}>
          <Notice>{error}</Notice>
          <button type="button" className="button primary" onClick={() => void load()}>Try again</button>
        </div>
      ) : null}
      {overview ? (
        <div className={styles.board}>
          <DashCard title="Next up">
            {overview.today.length === 0 ? <p className={styles.empty}>Nothing is scheduled for today’s date in Goa.</p> : (
              <ul className={styles.rows}>
                {overview.today.map((activity) => (
                  <li key={activity.id}>
                    <span className={styles.mark} data-kind="plan"><CalendarDays size={16} aria-hidden="true" /></span>
                    <div>
                      <p className={styles.when}>{activityTime(activity)} · {statusLabel[activity.status]}</p>
                      <strong>{activity.title}</strong>
                      {activity.location ? <p>{activity.location}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </DashCard>

          <DashCard title="Upcoming travel">
            {overview.upcomingTravel.length === 0 ? <p className={styles.empty}>No upcoming journey on this trip.</p> : (
              <ul className={styles.rows}>
                {overview.upcomingTravel.map((segment) => (
                  <li key={segment.id}>
                    <span className={styles.mark} data-kind="travel"><Plane size={16} aria-hidden="true" /></span>
                    <div>
                      <p className={styles.when}>{modeLabel[segment.mode]} · <time dateTime={segment.departureAt}>{formatWhen(segment.departureAt)}</time></p>
                      <strong>{segment.title}</strong>
                      <p>{segment.departurePlace} to {segment.arrivalPlace}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </DashCard>

          <DashCard title="Your people">
            {accepted.length === 0 ? <p className={styles.empty}>No accepted members yet.</p> : (
              <ul className={styles.people}>
                {accepted.map((member) => (
                  <li key={member.userId}>
                    <span className={styles.avatar}>{initials(member.displayName)}</span>
                    <strong>{member.displayName}</strong>
                    <span>{member.role === "organiser" ? "Trip host" : "Accepted"}</span>
                  </li>
                ))}
              </ul>
            )}
            {pending.length > 0 ? <p className={styles.note}>{pending.length} waiting for approval.</p> : null}
            <button type="button" className={styles.textAction} onClick={onOpenPeople}>Open your people</button>
          </DashCard>

          <DashCard title="Trip at a glance">
            <ul className={styles.glance}>
              <li><CalendarDays size={16} aria-hidden="true" /><span><strong>{days} {days === 1 ? "day" : "days"}</strong>{dateRange(trip.startDate, trip.endDate)}</span></li>
              <li><UserRound size={16} aria-hidden="true" /><span><strong>{accepted.length} {accepted.length === 1 ? "member" : "members"}</strong>Accepted on this trip</span></li>
              <li><CalendarDays size={16} aria-hidden="true" /><span><strong>{trip.activityCount} {trip.activityCount === 1 ? "plan" : "plans"}</strong>Saved on the itinerary</span></li>
            </ul>
          </DashCard>

          <DashCard title="Shared spending">
            {budgetError ? <p className={styles.empty}>{budgetError}</p> : null}
            {!budget && !budgetError ? <p className={styles.empty}>Opening the recorded spending…</p> : null}
            {budget ? (
              <>
                <p className={styles.figure}>{money(budget.actualTotalPaise)}</p>
                <p className={styles.note}>{budget.expenses.length} recorded {budget.expenses.length === 1 ? "expense" : "expenses"}. Repayments are not spending.</p>
                <p className={styles.note}>{budget.budgetPaise == null ? "No trip budget is set." : `Trip budget ${money(budget.budgetPaise)}.`} {money(budget.plannedTotalPaise)} is planned in the itinerary and stays out of balances.</p>
                {spendShare != null ? (
                  <div className={styles.meter}>
                    <div className={styles.track} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={spendShare.width} aria-label="Recorded spending against the trip budget">
                      <span style={{ width: `${spendShare.width}%` }} />
                    </div>
                    <p>{spendShare.label} of the trip budget is recorded spending.</p>
                  </div>
                ) : null}
              </>
            ) : null}
            <button type="button" className={styles.textAction} onClick={onOpenBudget}>Open Budget & splits</button>
          </DashCard>

          <DashCard title="Stay">
            {overview.stays.length === 0 ? <p className={styles.empty}>No current or upcoming stay.</p> : (
              <ul className={styles.rows}>
                {overview.stays.map((stay) => (
                  <li key={stay.id}>
                    <span className={styles.mark} data-kind="stay"><BedDouble size={16} aria-hidden="true" /></span>
                    <div>
                      <strong>{stay.propertyName}</strong>
                      {stay.address ? <p>{stay.address}</p> : null}
                      <p className={styles.when}>
                        <time dateTime={stay.checkIn}>{formatWhen(stay.checkIn)}</time>
                        {" to "}
                        <time dateTime={stay.checkOut}>{formatWhen(stay.checkOut)}</time>
                      </p>
                      <p>{stay.guestIds.length} {stay.guestIds.length === 1 ? "guest" : "guests"}{stay.contactName ? ` · ${stay.contactName}` : ""}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {mappedStays.length > 0 ? (
              <div className={styles.mapSlot}>
                <StayMap stays={mappedStays} compact />
              </div>
            ) : null}
          </DashCard>

          <DashCard title="Who to call">
            {overview.contacts.length === 0 ? <p className={styles.empty}>No contact cards yet.</p> : (
              <ul className={styles.rows}>
                {overview.contacts.map((contact) => (
                  <li key={contact.id}>
                    <span className={styles.mark} data-kind="call"><Phone size={16} aria-hidden="true" /></span>
                    <div>
                      <strong>{contact.name}</strong>
                      <p>{roleLabel[contact.role]}</p>
                      <PhoneLine phone={contact.phone} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </DashCard>
        </div>
      ) : null}
    </section>
  );
}
