"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api, core, type ExpenseParticipant } from "@/lib/client";
import type { ActivityAttendees, ActivityStatus, ActivityStatusValue } from "@/lib/trip-planning-types";
import { ActivityComments } from "./activity-comments";
import { BookingLinkPicker } from "./booking-link-picker";
import { PlanSection } from "./plan-section";
import { Busy, Notice } from "./ui";

const statusOptions: { value: ActivityStatusValue; label: string }[] = [
  { value: "planned", label: "Planned" },
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled", label: "Cancelled" },
];

function problem(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sameId(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function personName(id: string, people: ExpenseParticipant[] | null): string {
  return people?.find((person) => sameId(person.id, id))?.displayName ?? "Saved person";
}

export function ActivityExtras({ tripId, activityId, organiser }: { tripId: string; activityId: string; organiser: boolean }) {
  const statusId = useId();
  const statusHelpId = useId();
  const namesId = useId();
  const scope = `${tripId}\n${activityId}`;
  const seen = useRef(scope);
  const scopeRef = useRef(scope);
  const statusGen = useRef(0);
  const peopleGen = useRef(0);
  const attendeesGen = useRef(0);
  const [status, setStatus] = useState<ActivityStatusValue | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusLoadError, setStatusLoadError] = useState("");
  const [statusSaveError, setStatusSaveError] = useState("");
  const [statusBusy, setStatusBusy] = useState(false);
  const [attemptedStatus, setAttemptedStatus] = useState<ActivityStatusValue | null>(null);
  const [participants, setParticipants] = useState<ExpenseParticipant[] | null>(null);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [peopleError, setPeopleError] = useState("");
  const [savedIds, setSavedIds] = useState<string[] | null>(null);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [attendeesLoading, setAttendeesLoading] = useState(true);
  const [attendeesLoadError, setAttendeesLoadError] = useState("");
  const [attendeesSaveError, setAttendeesSaveError] = useState("");
  const [attendeesBusy, setAttendeesBusy] = useState(false);

  if (seen.current !== scope) {
    seen.current = scope;
    scopeRef.current = scope;
    statusGen.current += 1;
    peopleGen.current += 1;
    attendeesGen.current += 1;
    setStatus(null);
    setStatusLoading(true);
    setStatusLoadError("");
    setStatusSaveError("");
    setStatusBusy(false);
    setAttemptedStatus(null);
    setParticipants(null);
    setPeopleLoading(true);
    setPeopleError("");
    setSavedIds(null);
    setDraftIds([]);
    setAttendeesLoading(true);
    setAttendeesLoadError("");
    setAttendeesSaveError("");
    setAttendeesBusy(false);
  }
  scopeRef.current = scope;

  const statusUrl = `${core}/trips/${tripId}/activities/${activityId}/status`;
  const attendeesUrl = `${core}/trips/${tripId}/activities/${activityId}/attendees`;

  const loadStatus = useCallback(async () => {
    const current = ++statusGen.current;
    const at = scope;
    setStatusLoading(true);
    setStatusLoadError("");
    try {
      const result = await api<ActivityStatus>(statusUrl);
      if (statusGen.current !== current || scopeRef.current !== at) return;
      setStatus(result.status);
    } catch (error) {
      if (statusGen.current !== current || scopeRef.current !== at) return;
      setStatusLoadError(problem(error, "Unable to load the status."));
    } finally {
      if (statusGen.current === current) setStatusLoading(false);
    }
  }, [scope, statusUrl]);

  const loadPeople = useCallback(async () => {
    const current = ++peopleGen.current;
    const at = scope;
    setPeopleLoading(true);
    setPeopleError("");
    try {
      const result = await api<{ participants: ExpenseParticipant[] }>(`${core}/trips/${tripId}/expense-participants`);
      if (peopleGen.current !== current || scopeRef.current !== at) return;
      setParticipants(result.participants);
    } catch (error) {
      if (peopleGen.current !== current || scopeRef.current !== at) return;
      setPeopleError(problem(error, "Unable to load people for this trip."));
    } finally {
      if (peopleGen.current === current) setPeopleLoading(false);
    }
  }, [scope, tripId]);

  const loadAttendees = useCallback(async () => {
    const current = ++attendeesGen.current;
    const at = scope;
    setAttendeesLoading(true);
    setAttendeesLoadError("");
    try {
      const result = await api<ActivityAttendees>(attendeesUrl);
      if (attendeesGen.current !== current || scopeRef.current !== at) return;
      setSavedIds(result.participantIds);
      setDraftIds(result.participantIds);
    } catch (error) {
      if (attendeesGen.current !== current || scopeRef.current !== at) return;
      setAttendeesLoadError(problem(error, "Unable to load who is coming."));
    } finally {
      if (attendeesGen.current === current) setAttendeesLoading(false);
    }
  }, [attendeesUrl, scope]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { void loadPeople(); }, [loadPeople]);
  useEffect(() => { void loadAttendees(); }, [loadAttendees]);

  const saveStatus = async (next: ActivityStatusValue) => {
    if (statusBusy) return;
    const current = ++statusGen.current;
    const previous = status;
    const at = scope;
    setStatus(next);
    setStatusBusy(true);
    setStatusLoading(false);
    setStatusSaveError("");
    setAttemptedStatus(next);
    try {
      const result = await api<ActivityStatus>(statusUrl, { method: "PUT", body: JSON.stringify({ status: next }) });
      if (statusGen.current !== current || scopeRef.current !== at) return;
      setStatus(result.status);
      setAttemptedStatus(null);
    } catch (error) {
      if (statusGen.current !== current || scopeRef.current !== at) return;
      setStatus(previous);
      setStatusSaveError(problem(error, "Unable to save the status."));
    } finally {
      if (statusGen.current === current && scopeRef.current === at) setStatusBusy(false);
    }
  };

  const saveAttendees = async () => {
    if (attendeesBusy || savedIds === null) return;
    const current = ++attendeesGen.current;
    const at = scope;
    setAttendeesBusy(true);
    setAttendeesLoading(false);
    setAttendeesSaveError("");
    try {
      const result = await api<ActivityAttendees>(attendeesUrl, { method: "PUT", body: JSON.stringify({ participantIds: draftIds }) });
      if (attendeesGen.current !== current || scopeRef.current !== at) return;
      setSavedIds(result.participantIds);
      setDraftIds(result.participantIds);
    } catch (error) {
      if (attendeesGen.current !== current || scopeRef.current !== at) return;
      setAttendeesSaveError(problem(error, "Unable to save attendees."));
    } finally {
      if (attendeesGen.current === current && scopeRef.current === at) setAttendeesBusy(false);
    }
  };

  const togglePerson = (id: string) => {
    setDraftIds((current) => current.some((item) => sameId(item, id)) ? current.filter((item) => !sameId(item, id)) : [...current, id]);
  };

  const known = new Set((participants ?? []).map((person) => person.id.toLowerCase()));
  const unseen = (savedIds ?? []).filter((id) => !known.has(id.toLowerCase()));
  const coming = savedIds?.map((id) => personName(id, participants)) ?? [];
  const statusSummary = status
    ? (statusOptions.find((option) => option.value === status)?.label ?? "Saved on this day")
    : "A cancelled plan stays on this day.";
  const peopleSummary = savedIds
    ? (coming.length ? `Coming: ${coming.join(", ")}` : "No one is marked for this plan yet.")
    : "Who is on this plan.";

  return <section style={blockStyle} aria-label="Status, people, and booking">
    <PlanSection title="Status" summary={statusSummary} expand={Boolean(statusLoadError || statusSaveError)}>
    <div style={stackStyle}>
      {statusLoadError && <Notice>{statusLoadError} <button type="button" className="text-button" onClick={() => void loadStatus()}>Retry</button></Notice>}
      {statusLoading && status === null ? <p style={hintStyle} role="status"><Busy text="Loading status…" /></p> : null}
      {status && <label htmlFor={statusId} style={fieldStyle}>Status
        <select id={statusId} value={status} disabled={statusBusy} aria-describedby={statusHelpId} aria-invalid={statusSaveError ? true : undefined} onChange={(event) => {
          const next = event.target.value;
          if (next === "planned" || next === "confirmed" || next === "cancelled") void saveStatus(next);
        }}>
          {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>}
      {statusBusy ? <p style={hintStyle} role="status"><Busy text="Saving status…" /></p> : null}
      {statusSaveError && <Notice>{statusSaveError} {attemptedStatus && <button type="button" className="text-button" onClick={() => void saveStatus(attemptedStatus)}>Retry</button>}</Notice>}
      <p id={statusHelpId} style={hintStyle}>A cancelled plan stays on this day.</p>
    </div>
    </PlanSection>
    <PlanSection title="Who is coming" summary={peopleSummary} summaryId={namesId} expand={Boolean(peopleError || attendeesLoadError || attendeesSaveError)}>
    <div style={stackStyle}>
      {peopleError && <Notice>{peopleError} <button type="button" className="text-button" onClick={() => void loadPeople()}>Retry</button></Notice>}
      {attendeesLoadError && <Notice>{attendeesLoadError} <button type="button" className="text-button" onClick={() => void loadAttendees()}>Retry</button></Notice>}
      {(peopleLoading && participants === null) || (attendeesLoading && savedIds === null) ? <p style={hintStyle} role="status"><Busy text="Loading who is coming…" /></p> : null}
      {participants && savedIds && <fieldset style={peopleStyle}>
        <legend style={legendStyle}>Who is coming</legend>
        {participants.length === 0 && unseen.length === 0 ? <p style={hintStyle}>No people are on this trip yet. You can still save an empty list.</p> : null}
        <div style={listStyle}>
          {participants.map((person) => <label key={person.id} style={personStyle}>
            <input type="checkbox" style={checkboxStyle} disabled={attendeesBusy} checked={draftIds.some((id) => sameId(id, person.id))} onChange={() => togglePerson(person.id)} />
            <span>{person.displayName}{person.kind === "guest" ? " · Guest" : ""}{!person.active ? " · Inactive" : ""}</span>
          </label>)}
          {unseen.map((id) => <label key={id} style={personStyle}>
            <input type="checkbox" style={checkboxStyle} disabled={attendeesBusy} checked={draftIds.some((item) => sameId(item, id))} onChange={() => togglePerson(id)} />
            <span>Saved person</span>
          </label>)}
        </div>
        {attendeesSaveError && <Notice>{attendeesSaveError} <button type="button" className="text-button" onClick={() => void saveAttendees()}>Retry</button></Notice>}
        <div style={actionStyle}>
          <button type="button" className="button secondary" style={{ width: "100%" }} disabled={attendeesBusy} onClick={() => void saveAttendees()} aria-describedby={namesId}>{attendeesBusy ? <Busy text="Saving attendees…" /> : "Save attendees"}</button>
        </div>
      </fieldset>}
    </div>
    </PlanSection>
    <BookingLinkPicker tripId={tripId} targetType="activity" targetId={activityId} />
    <ActivityComments tripId={tripId} activityId={activityId} organiser={organiser} />
  </section>;
}

const blockStyle = {
  width: "100%",
  minWidth: 0,
  display: "flex",
  flexDirection: "column" as const,
  gap: 16,
  marginTop: 16,
  paddingTop: 16,
  borderTop: "1px solid #e7eadf",
  boxSizing: "border-box" as const,
};

const stackStyle = { display: "flex", flexDirection: "column" as const, gap: 8, minWidth: 0, width: "100%" };
const fieldStyle = { display: "flex", flexDirection: "column" as const, gap: 8, width: "100%", minWidth: 0, margin: 0 };
const hintStyle = { margin: 0, color: "#687c75", fontSize: 13, lineHeight: 1.6, fontWeight: 400 };
const peopleStyle = { border: "1px solid #e8d9b4", borderRadius: 10, margin: 0, padding: 12, minWidth: 0, maxWidth: "100%" };
const legendStyle = { padding: "0 4px", fontSize: 13, fontWeight: 600, color: "#173f35" };
const listStyle = { display: "flex", flexDirection: "column" as const, gap: 2, minWidth: 0 };
const personStyle = { display: "flex", flexDirection: "row" as const, alignItems: "center", gap: 10, minHeight: 44, width: "100%", margin: 0, fontWeight: 500, cursor: "pointer" };
const checkboxStyle = { width: 20, height: 20, minWidth: 20, minHeight: 20, maxWidth: 20, flex: "0 0 20px", margin: 0, padding: 0 };
const actionStyle = { display: "flex", flexWrap: "wrap" as const, gap: 8, marginTop: 8 };
