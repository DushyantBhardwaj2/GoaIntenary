"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ListChecks, Plus } from "lucide-react";
import { api, core, type Member, type TripDetail, type User } from "@/lib/client";
import type { ChecklistItem, ChecklistItemInput, ChecklistPatch, ChecklistVisibility } from "@/lib/trip-planning-types";
import { Busy, Dialog, Notice } from "./ui";
import styles from "./checklist.module.css";

const packedFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function packedLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return packedFormat.format(date);
}

function initials(name: string): string {
  const letters = name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
  return letters || "?";
}

function personLabel(userId: string, members: Member[], selfId: string): { name: string; letters: string } {
  const member = members.find((item) => item.userId === userId);
  const name = member?.displayName ?? "A traveller";
  return { name: userId === selfId ? "you" : name, letters: initials(member?.displayName ?? name) };
}

function rights(item: ChecklistItem, userId: string, organiser: boolean) {
  if (item.visibility === "personal") return { complete: true, edit: true, remove: true };
  const creator = item.createdBy === userId;
  return {
    complete: organiser || item.assigneeUserId === userId,
    edit: organiser || creator,
    remove: organiser || creator,
  };
}

function ItemForm({ tripId, item, accepted, onClose, onSaved }: {
  tripId: string;
  item?: ChecklistItem;
  accepted: Member[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const titleId = useId();
  const assigneeId = useId();
  const visibilityName = useId();
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const [visibility, setVisibility] = useState<ChecklistVisibility>(item?.visibility ?? "personal");
  const [title, setTitle] = useState(item?.title ?? "");
  const knownAssignee = item?.assigneeUserId && accepted.some((member) => member.userId === item.assigneeUserId) ? item.assigneeUserId : "";
  const keepCurrent = Boolean(item?.assigneeUserId && !knownAssignee);
  const [assignee, setAssignee] = useState(keepCurrent ? "__keep__" : knownAssignee);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const shared = item ? item.visibility === "shared" : visibility === "shared";

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const trimmed = title.trim();
      if (!trimmed) throw new Error("Give the item a title.");
      if (!item) {
        if (visibility === "shared" && assignee && !accepted.some((member) => member.userId === assignee)) {
          throw new Error("Choose an accepted member, or leave the item unassigned.");
        }
        const body: ChecklistItemInput = {
          visibility,
          title: trimmed,
          assigneeUserId: visibility === "shared" && assignee && assignee !== "__keep__" ? assignee : null,
        };
        const payload = JSON.stringify(body);
        if (!attempt.current || attempt.current.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
        await api(`${core}/trips/${tripId}/checklist`, {
          method: "POST",
          headers: { "Idempotency-Key": attempt.current.key },
          body: payload,
        });
      } else {
        const patch: ChecklistPatch = { title: trimmed };
        if (item.visibility === "shared" && assignee !== "__keep__") {
          const nextAssignee = assignee || null;
          if (nextAssignee !== item.assigneeUserId) patch.assigneeUserId = nextAssignee;
        }
        await api(`${core}/trips/${tripId}/checklist/${item.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save this item.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void save();
  };

  return <Dialog title={item ? "Edit this item" : "Add a to-do"} onClose={onClose} busy={busy}>
    <form className={`premium-form ${styles.form}`} onSubmit={submit} autoComplete="off">
      <p className="helper-text">
        {item
          ? item.visibility === "personal"
            ? "This stays personal. A title change does not share it."
            : "This stays shared with everyone who has joined. Leave the assignee blank if nobody owns it yet."
          : "Personal items stay off everyone else's list, including the organiser. Shared items are visible to every accepted member."}
      </p>
      {!item && <fieldset className={styles.choice}>
        <legend>Who can see this</legend>
        <label className={styles.option}>
          <input type="radio" name={visibilityName} value="personal" checked={visibility === "personal"} onChange={() => setVisibility("personal")} />
          Personal
        </label>
        <label className={styles.option}>
          <input type="radio" name={visibilityName} value="shared" checked={visibility === "shared"} onChange={() => setVisibility("shared")} />
          Shared
        </label>
      </fieldset>}
      <label htmlFor={titleId}>Item
        <input id={titleId} autoFocus required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Sunscreen, cab booking, or a pharmacy stop" />
      </label>
      {shared && <label htmlFor={assigneeId}>Assignee <span>(optional)</span>
        <select id={assigneeId} value={assignee} onChange={(event) => setAssignee(event.target.value)}>
          {keepCurrent && <option value="__keep__">Keep the current assignee</option>}
          <option value="">No one yet</option>
          {accepted.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
        </select>
      </label>}
      {shared && <p className="helper-text">Choose an accepted member, or save the shared item with no assignee.</p>}
      {keepCurrent && <p className="helper-text">The current assignee is not an accepted member. Keep that assignment, choose someone who has joined, or leave the item unassigned.</p>}
      {error && <Notice>{error} <button type="button" className="text-button" onClick={() => void save()}>Retry</button></Notice>}
      <div className="dialog-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="button primary" type="submit" disabled={busy}>{busy ? <Busy text="Saving…" /> : "Save item"}</button>
      </div>
    </form>
  </Dialog>;
}

export function ChecklistPanel({ tripId }: { tripId: string }) {
  const personalId = useId();
  const sharedId = useId();
  const [items, setItems] = useState<ChecklistItem[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [userId, setUserId] = useState("");
  const [organiser, setOrganiser] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [toggleError, setToggleError] = useState("");
  const [actionError, setActionError] = useState("");
  const [draft, setDraft] = useState<{ item?: ChecklistItem } | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  const [removing, setRemoving] = useState<ChecklistItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const retryRef = useRef<(() => Promise<void>) | null>(null);
  const seenTrip = useRef(tripId);
  const generation = useRef(0);
  if (seenTrip.current !== tripId) {
    seenTrip.current = tripId;
    setItems(null);
    setMembers([]);
    setUserId("");
    setOrganiser(false);
    setLoadError("");
    setToggleError("");
    setActionError("");
    setDraft(null);
    setRemoving(null);
    setFilter("all");
    setLoading(true);
  }

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setLoadError("");
    try {
      const [list, trip, profile] = await Promise.all([
        api<{ items: ChecklistItem[] }>(`${core}/trips/${tripId}/checklist`),
        api<TripDetail>(`${core}/trips/${tripId}`),
        api<{ user: User }>(`${core}/me`),
      ]);
      if (generation.current !== current) return;
      setItems(list.items);
      setMembers(trip.members);
      setOrganiser(trip.trip.role === "organiser");
      setUserId(profile.user.id);
    } catch (err) {
      if (generation.current !== current) return;
      setLoadError(err instanceof Error ? err.message : "Unable to load the packing list.");
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [tripId]);

  useEffect(() => { void load(); }, [load]);

  const accepted = members.filter((member) => member.status === "accepted")
    .slice()
    .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.userId.localeCompare(right.userId));
  const allItems = items ?? [];
  const matches = (item: ChecklistItem) => filter === "all" || (filter === "done" ? Boolean(item.completedAt) : !item.completedAt);
  const personal = allItems.filter((item) => item.visibility === "personal" && matches(item));
  const shared = allItems.filter((item) => item.visibility === "shared" && matches(item));
  const doneCount = allItems.filter((item) => item.completedAt).length;
  const progress = allItems.length === 0 ? 0 : Math.floor((doneCount * 100) / allItems.length);

  const toggle = async (item: ChecklistItem) => {
    setBusyId(item.id);
    setToggleError("");
    try {
      const completedAt = item.completedAt ? null : new Date().toISOString();
      await api(`${core}/trips/${tripId}/checklist/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ completedAt }),
      });
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update this item.";
      retryRef.current = () => toggle(item);
      setToggleError(message);
    } finally {
      setBusyId(null);
    }
  };

  const removeItem = async () => {
    if (!removing) return;
    setBusy(true);
    setActionError("");
    try {
      await api(`${core}/trips/${tripId}/checklist/${removing.id}`, { method: "DELETE" });
      setRemoving(null);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to remove this item.";
      retryRef.current = () => removeItem();
      setActionError(message);
    } finally {
      setBusy(false);
    }
  };

  const renderItem = (item: ChecklistItem) => {
    const done = Boolean(item.completedAt);
    const ability = rights(item, userId, organiser);
    const creator = personLabel(item.createdBy, members, userId);
    const assignee = item.assigneeUserId ? personLabel(item.assigneeUserId, members, userId) : null;
    const itemBusy = busyId === item.id;
    return <li key={item.id}>
      <article className={styles.item} data-visibility={item.visibility} data-done={done ? "true" : "false"} aria-busy={itemBusy}>
        {ability.complete ? <label className={styles.check}>
          <input type="checkbox" checked={done} disabled={itemBusy} onChange={() => void toggle(item)} />
          <span className={styles.checkCopy}>
            <span className={styles.itemTitle}>{item.title}</span>
            <span className={styles.state}>{done ? "Packed" : "Still to pack"}</span>
          </span>
        </label> : <div className={styles.readOnly}>
          <h4 className={styles.itemTitle}>{item.title}</h4>
          <p className={styles.state}>{done ? "Packed" : "Still to pack"}</p>
        </div>}
        <p className={styles.who}><span>Created by</span><span className={styles.mini}>{creator.letters}</span><span>{creator.name}</span></p>
        {item.visibility === "shared" && <p className={styles.who}><span>Assigned to</span>{assignee ? <><span className={styles.mini}>{assignee.letters}</span><span>{assignee.name}</span></> : <span>No one yet</span>}</p>}
        {item.completedAt && <p className={styles.when}>Packed <time dateTime={item.completedAt}>{packedLabel(item.completedAt)}</time></p>}
        {(ability.edit || ability.remove) && <div className={styles.actions}>
          {ability.edit && <button className="button secondary" type="button" aria-label={`Edit ${item.title}`} disabled={itemBusy} onClick={() => { setRemoving(null); setDraft({ item }); }}>Edit</button>}
          {ability.remove && <button className="button secondary" type="button" aria-label={`Remove ${item.title}`} disabled={itemBusy} onClick={() => { setDraft(null); setActionError(""); setRemoving(item); }}>Remove</button>}
        </div>}
      </article>
    </li>;
  };

  return <section className={styles.panel} aria-label="Notes and to-dos" aria-busy={loading}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <span className={styles.kicker}><ListChecks size={15} aria-hidden="true" /> NOTES AND TO-DOS</span>
        <h2>Notes & to-dos</h2>
        <p>The little things that keep the trip moving. Personal items stay on your list. Shared items are visible to everyone who has joined.</p>
      </div>
      <button className="button coral" type="button" disabled={items === null} onClick={() => { setRemoving(null); setDraft({}); }}>
        <Plus size={17} aria-hidden="true" />Add a to-do
      </button>
    </header>
    {items && items.length > 0 && <div className={styles.progressRow}>
      <div className={styles.filters} role="group" aria-label="Filter the list">
        {([["all", "All", allItems.length], ["open", "Open", allItems.length - doneCount], ["done", "Done", doneCount]] as const).map(([id, label, count]) => (
          <button key={id} type="button" className={styles.chip} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label} <span>{count}</span></button>
        ))}
      </div>
      <div className={styles.progress}>
        <p>{doneCount} of {allItems.length} done</p>
        <div className={styles.track} role="progressbar" aria-valuemin={0} aria-valuemax={allItems.length} aria-valuenow={doneCount} aria-label="To-dos completed">
          <span style={{ width: `${progress}%` }} />
        </div>
        <p>{progress}%</p>
      </div>
    </div>}
    {loadError && <Notice>{loadError} <button type="button" className="text-button" onClick={() => void load()}>Retry</button></Notice>}
    {toggleError && <Notice>{toggleError} <button type="button" className="text-button" onClick={() => void retryRef.current?.()}>Retry</button></Notice>}
    {loading && items === null ? <div className={styles.loading}><Busy text="Checking the list…" /></div> : null}
    {items && items.length === 0 && <p className={styles.emptyLead}>The list is clear. Add a personal note or a shared task for the group.</p>}
    {items && <div className={styles.groups}>
      <section className={styles.group} data-visibility="personal" aria-labelledby={personalId}>
        <div className={styles.groupHead}>
          <h3 id={personalId}>Personal</h3>
          {personal.length > 0 && <p className={styles.tally}>{personal.filter((item) => !item.completedAt).length} still open</p>}
        </div>
        <p className="helper-text">Only you can see these, including from the organiser.</p>
        {personal.length === 0 ? <p className={styles.none}>{filter === "all" ? "No personal items yet" : "None in this view"}</p> : <ul className={styles.items}>{personal.map(renderItem)}</ul>}
      </section>
      <section className={styles.group} data-visibility="shared" aria-labelledby={sharedId}>
        <div className={styles.groupHead}>
          <h3 id={sharedId}>Shared</h3>
          {shared.length > 0 && <p className={styles.tally}>{shared.filter((item) => !item.completedAt).length} still open</p>}
        </div>
        <p className="helper-text">Everyone who has joined can see these. The assignee or the organiser can mark one done.</p>
        {shared.length === 0 ? <p className={styles.none}>{filter === "all" ? "No shared items yet" : "None in this view"}</p> : <ul className={styles.items}>{shared.map(renderItem)}</ul>}
      </section>
      <aside className={styles.memory} aria-hidden="true"><p>Small steps.<br />Bigger memories.</p></aside>
    </div>}
    {draft && <ItemForm key={draft.item?.id ?? "create"} tripId={tripId} item={draft.item} accepted={accepted} onClose={() => setDraft(null)} onSaved={load} />}
    {removing && <Dialog title="Remove this item?" onClose={() => { if (!busy) setRemoving(null); }} busy={busy}>
      <p>This hides “{removing.title}” from the list.</p>
      {actionError && <Notice>{actionError} <button type="button" className="text-button" onClick={() => void removeItem()}>Retry</button></Notice>}
      <div className="dialog-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={() => setRemoving(null)}>Keep item</button>
        <button className="button primary" type="button" disabled={busy} onClick={() => void removeItem()}>{busy ? <Busy text="Removing…" /> : "Remove item"}</button>
      </div>
    </Dialog>}
  </section>;
}
