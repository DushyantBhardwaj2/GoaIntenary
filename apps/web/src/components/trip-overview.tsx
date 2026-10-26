"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Phone } from "lucide-react";
import { api, core } from "@/lib/client";
import type { ActivityStatusValue, ContactRole, OverviewActivity, TravelMode, TripOverview as TripOverviewData } from "@/lib/trip-planning-types";
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
  if (activity.startTime && activity.endTime) return `${activity.startTime} to ${activity.endTime}`;
  if (activity.startTime) return activity.startTime;
  if (activity.endTime) return activity.endTime;
  return "No time set";
}

function OverviewGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const headingId = useId();
  return (
    <section className={styles.group} aria-labelledby={headingId}>
      <h3 id={headingId}>{title}</h3>
      {count === 0 ? <p className={styles.empty}>There is nothing in {title}.</p> : children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function PhoneLine({ phone }: { phone: string }) {
  const href = callHref(phone);
  if (!phone.trim()) return <p className={styles.phoneText}>No number yet</p>;
  if (!href) return <p className={styles.phoneText}>{phone}</p>;
  return <a className={styles.phoneLink} href={href}><Phone size={16} aria-hidden="true" />{phone}</a>;
}

export function TripOverview({ tripId }: { tripId: string }) {
  const headingId = useId();
  const generation = useRef(0);
  const seenTrip = useRef(tripId);
  const [overview, setOverview] = useState<TripOverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  if (seenTrip.current !== tripId) {
    seenTrip.current = tripId;
    setOverview(null);
    setError("");
    setLoading(true);
  }

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const data = await api<TripOverviewData>(`${core}/trips/${tripId}/overview`);
      if (generation.current !== current) return;
      setOverview(data);
    } catch (err) {
      if (generation.current !== current) return;
      setOverview(null);
      setError(err instanceof Error ? err.message : "Unable to load today.");
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [tripId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className={styles.panel} aria-labelledby={headingId} aria-busy={loading}>
      <header className={styles.header}>
        <p className={styles.kicker}>TODAY IN GOA</p>
        <h2 id={headingId}>Today</h2>
        <p>Activities for today’s date in Goa, the next journeys, the stays, and who to call.</p>
      </header>
      {loading && !overview ? <div className={styles.loading} role="status"><Busy text="Loading today…" /></div> : null}
      {!loading && error ? (
        <div className={styles.recovery}>
          <Notice>{error}</Notice>
          <button type="button" className="button primary" onClick={() => void load()}>Try again</button>
        </div>
      ) : null}
      {overview ? (
        <div className={styles.groups}>
          <OverviewGroup title="Today" count={overview.today.length}>
            <ul className={styles.cards}>
              {overview.today.map((activity) => (
                <li key={activity.id} className={styles.card}>
                  <h4>{activity.title}</h4>
                  <dl className={styles.facts}>
                    <Fact label="Time">{activityTime(activity)}</Fact>
                    <Fact label="Status"><span data-status={activity.status}>{statusLabel[activity.status]}</span></Fact>
                  </dl>
                </li>
              ))}
            </ul>
          </OverviewGroup>
          <OverviewGroup title="Upcoming travel" count={overview.upcomingTravel.length}>
            <ul className={styles.cards}>
              {overview.upcomingTravel.map((segment) => (
                <li key={segment.id} className={styles.card}>
                  <h4>{segment.title}</h4>
                  <dl className={styles.facts}>
                    <Fact label="Mode">{modeLabel[segment.mode]}</Fact>
                    <Fact label="Departs"><time dateTime={segment.departureAt}>{formatWhen(segment.departureAt)}</time></Fact>
                  </dl>
                </li>
              ))}
            </ul>
          </OverviewGroup>
          <OverviewGroup title="Stays" count={overview.stays.length}>
            <ul className={styles.cards}>
              {overview.stays.map((stay) => (
                <li key={stay.id} className={styles.card}>
                  <h4>{stay.propertyName}</h4>
                  <dl className={styles.facts}>
                    <Fact label="Check-in"><time dateTime={stay.checkIn}>{formatWhen(stay.checkIn)}</time></Fact>
                    <Fact label="Check-out"><time dateTime={stay.checkOut}>{formatWhen(stay.checkOut)}</time></Fact>
                  </dl>
                </li>
              ))}
            </ul>
          </OverviewGroup>
          <OverviewGroup title="Contacts" count={overview.contacts.length}>
            <ul className={styles.cards}>
              {overview.contacts.map((contact) => (
                <li key={contact.id} className={styles.card}>
                  <h4>{contact.name}</h4>
                  <dl className={styles.facts}>
                    <Fact label="Role">{roleLabel[contact.role]}</Fact>
                    <Fact label="Phone"><PhoneLine phone={contact.phone} /></Fact>
                  </dl>
                </li>
              ))}
            </ul>
          </OverviewGroup>
        </div>
      ) : null}
    </section>
  );
}
