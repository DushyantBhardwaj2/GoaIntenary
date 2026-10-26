"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Camera, Clapperboard, MapPin, Pencil, Plus, RefreshCw, Trash2, Users } from "lucide-react";
import { api, ApiError, core, type Member } from "@/lib/client";
import { instagramReference, type ReelIdea, type ReelIdeaInput } from "@/lib/reel-types";
import { useSession } from "./session";
import { Busy, Dialog, Notice } from "./ui";
import styles from "./reel.module.css";

type PanelProps = { tripId: string; members: Member[]; role: "organiser" | "member" };
type Filter = "all" | ReelIdeaInput["kind"];

function memberName(id: string, members: Member[]): string {
  const member = members.find((person) => person.userId === id);
  if (!member) return "Former member";
  return `${member.displayName}${member.status === "accepted" ? "" : " (left trip)"}`;
}

function IdeaForm({ tripId, members, selfId, idea, onClose, onSaved }: {
  tripId: string; members: Member[]; selfId: string; idea?: ReelIdea;
  onClose: () => void; onSaved: (saved: ReelIdea) => void;
}) {
  const accepted = members.filter((member) => member.status === "accepted");
  const [title, setTitle] = useState(idea?.title ?? "");
  const [kind, setKind] = useState<ReelIdeaInput["kind"]>(idea?.kind ?? "reel");
  const [reference, setReference] = useState(idea?.instagramUrl ?? "");
  const [location, setLocation] = useState(idea?.location ?? "");
  const [notes, setNotes] = useState(idea?.notes ?? "");
  const [people, setPeople] = useState<string[]>(() => idea
    ? idea.participantUserIds.filter((id) => accepted.some((person) => person.userId === id))
    : accepted.some((person) => person.userId === selfId) ? [selfId] : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const submitting = useRef(false);
  const hasFormerMembers = idea?.participantUserIds.some((id) => !accepted.some((person) => person.userId === id));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (!title.trim()) throw new Error("Give your idea a title.");
      if (people.length === 0) throw new Error("Choose at least one person for this idea.");
      const instagramUrl = instagramReference(reference);
      if (reference.trim() && !instagramUrl) throw new Error("Use an Instagram link beginning with https://, or leave the link blank.");
      const input: ReelIdeaInput = {
        title: title.trim(), kind, instagramUrl, location: location.trim(), notes: notes.trim(),
        participantUserIds: [...people].sort(),
      };
      const payload = JSON.stringify(idea ? { ...input, version: idea.version } : input);
      if (!attempt.current || attempt.current.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
      const result = await api<{ idea: ReelIdea }>(`${core}/trips/${tripId}/reel-ideas${idea ? `/${idea.id}` : ""}`, {
        method: idea ? "PATCH" : "POST",
        headers: idea ? {} : { "Idempotency-Key": attempt.current.key },
        body: payload,
      });
      onSaved(result.idea);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 && idea
        ? "This idea has changed since you opened it. Your edits are still here. Copy any notes you want to keep, then close and refresh the ideas before editing again."
        : err instanceof Error ? err.message : "Unable to save this idea. Your changes are still here; try again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return <Dialog title={idea ? "Edit your idea" : "Save a little inspiration"} busy={busy} onClose={onClose} className={styles.dialog}>
    <form className={`premium-form ${styles.form}`} onSubmit={submit}>
      <p className={styles.formIntro}>Keep the reference, the place, and the people who want to make it happen.</p>
      <fieldset className={styles.fields} disabled={busy}>
        <label>Idea title
          <input autoFocus required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Sunset transition at Palolem" />
        </label>
        <fieldset className={styles.kindField}>
          <legend>What are we making?</legend>
          <div className={styles.kindOptions}>
            {(["reel", "photo"] as const).map((value) => <label key={value} className={styles.kindOption} data-selected={kind === value}>
              <input type="radio" name="idea-kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
              {value === "reel" ? <Clapperboard size={18} aria-hidden="true" /> : <Camera size={18} aria-hidden="true" />}
              {value === "reel" ? "Reel" : "Photo"}
            </label>)}
          </div>
        </fieldset>
        <label>Instagram URL <span>(optional)</span>
          <input type="url" inputMode="url" maxLength={2048} value={reference} onChange={(event) => setReference(event.target.value)} placeholder="https://www.instagram.com/reel/…" />
        </label>
        <p className={styles.hint}>Paste a reel or post for inspiration, or save an idea of your own.</p>
        <fieldset className={styles.peopleField}>
          <legend>Who wants to make this?</legend>
          <p className={styles.hint}>Choose one or more people from the trip.</p>
          <div className={styles.peopleOptions}>
            {accepted.map((person) => <label key={person.userId} className={styles.personOption} data-selected={people.includes(person.userId)}>
              <input type="checkbox" checked={people.includes(person.userId)} onChange={(event) => setPeople((current) => event.target.checked ? [...current, person.userId] : current.filter((id) => id !== person.userId))} />
              <span>{person.displayName}{person.userId === selfId ? " (you)" : ""}</span>
            </label>)}
          </div>
          {accepted.length === 0 && <p className={styles.hint}>No accepted members are available. Refresh the trip to try again.</p>}
          {hasFormerMembers && <p className={styles.hint}>People who have left the trip are no longer selected.</p>}
        </fieldset>
        <label>Place <span>(optional)</span>
          <input maxLength={200} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Palolem beach, on our sunset walk" />
        </label>
        <label>The idea <span>(optional)</span>
          <textarea rows={4} maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="The shot, the pose, the timing. Anything you want to remember." />
        </label>
      </fieldset>
      {error && <Notice>{error}</Notice>}
      <div className="dialog-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="button primary" type="submit" disabled={busy || accepted.length === 0}>{busy ? <Busy text="Saving…" /> : "Save idea"}</button>
      </div>
    </form>
  </Dialog>;
}

function ReelIdeas({ tripId, members, role, selfId }: PanelProps & { selfId: string }) {
  const [ideas, setIdeas] = useState<ReelIdea[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState<{ idea?: ReelIdea } | null>(null);
  const [removing, setRemoving] = useState<ReelIdea | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await api<{ ideas: ReelIdea[] }>(`${core}/trips/${tripId}/reel-ideas`);
      if (current === generation.current) setIdeas(result.ideas);
    } catch (err) {
      if (current !== generation.current) return;
      if (err instanceof ApiError && (err.status === 401 || err.status === 403 || err.status === 404)) setIdeas(null);
      setError(err instanceof Error ? err.message : "Unable to load ideas. Try again.");
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [tripId]);

  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);

  const saved = (idea: ReelIdea) => {
    generation.current++;
    setLoading(false);
    setIdeas((current) => [idea, ...(current ?? []).filter((item) => item.id !== idea.id)]);
    setMessage("Idea saved for the trip.");
    setFilter("all");
  };

  const remove = async () => {
    if (!removing || busy) return;
    setBusy(true);
    setRemoveError("");
    try {
      await api(`${core}/trips/${tripId}/reel-ideas/${removing.id}`, { method: "DELETE" });
      generation.current++;
      setLoading(false);
      setIdeas((current) => current?.filter((item) => item.id !== removing.id) ?? null);
      setRemoving(null);
      setMessage("Idea removed from the trip.");
    } catch (err) {
      setRemoveError(err instanceof Error ? err.message : "Unable to remove this idea. Try again.");
    } finally { setBusy(false); }
  };

  const visible = (ideas ?? []).filter((idea) => filter === "all" || idea.kind === filter);

  return <section className={styles.panel} aria-label="Reel and photo ideas" aria-busy={loading}>
    <header className={styles.header}>
      <div className={styles.heading}>
        <span className={styles.kicker}><Clapperboard size={15} aria-hidden="true" /> THE MEMORY BOARD</span>
        <h2>Reel &amp; photo ideas</h2>
        <p>A reel to recreate. A photo to take. Keep a little inspiration for when you get there.</p>
      </div>
      <button type="button" className="button primary" disabled={ideas === null} onClick={() => { setMessage(""); setDraft({}); }}><Plus size={17} aria-hidden="true" />Add an idea</button>
    </header>
    {message && <Notice tone="success">{message}</Notice>}
    {error && <Notice>{error} <button type="button" className="text-button" onClick={() => void load()}>Try again</button></Notice>}
    {loading && ideas === null && <div className={styles.loading}><Busy text="Opening the memory board…" /></div>}
    {ideas !== null && <>
      <div className={styles.toolbar}>
        <div className={styles.filters} role="group" aria-label="Filter ideas">
          {([{ value: "all", label: "All ideas" }, { value: "reel", label: "Reels" }, { value: "photo", label: "Photos" }] as const).map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} className={styles.filter} onClick={() => setFilter(item.value)}>
            {item.label}<span>{ideas.filter((idea) => item.value === "all" || idea.kind === item.value).length}</span>
          </button>)}
        </div>
        <button type="button" className={styles.refresh} disabled={loading} onClick={() => void load()}><RefreshCw size={15} aria-hidden="true" />Refresh</button>
      </div>
      {visible.length === 0 ? <div className={styles.empty}>
        <div className={styles.emptyIcon} aria-hidden="true"><Camera size={32} strokeWidth={1.3} /></div>
        <span className={styles.kicker}>GOOD MEMORIES START SOMEWHERE</span>
        <h3>{ideas.length === 0 ? "Your next favourite memory." : `No ${filter === "photo" ? "photo" : "reel"} ideas yet.`}</h3>
        <p>Save an Instagram reference or a shot you have in mind, then choose who is in.</p>
        <button type="button" className="button secondary" onClick={() => { setMessage(""); setDraft({}); }}><Plus size={16} aria-hidden="true" />Save your first idea</button>
      </div> : <ul className={styles.cards}>
        {visible.map((idea, index) => {
          const canManage = role === "organiser" || idea.createdBy === selfId;
          const reference = instagramReference(idea.instagramUrl);
          return <li key={idea.id}>
            <article className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.kind} data-kind={idea.kind}>{idea.kind === "reel" ? <Clapperboard size={15} aria-hidden="true" /> : <Camera size={15} aria-hidden="true" />}{idea.kind === "reel" ? "Reel" : "Photo"}</span>
                <span className={styles.number} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              </div>
              <h3>{idea.title}</h3>
              {idea.location && <p className={styles.location}><MapPin size={15} aria-hidden="true" /><span>{idea.location}</span></p>}
              {idea.notes && <p className={styles.notes}>{idea.notes}</p>}
              <div className={styles.participants}>
                <span className={styles.peopleCaption}><Users size={14} aria-hidden="true" />WHO’S IN</span>
                <ul>{idea.participantUserIds.map((id) => <li key={id}>{memberName(id, members)}{id === selfId ? " · you" : ""}</li>)}</ul>
              </div>
              <div className={styles.cardFoot}>
                {reference ? <a className={styles.reference} href={reference} target="_blank" rel="noopener noreferrer">Open Instagram<ArrowUpRight size={16} aria-hidden="true" /><span className={styles.srOnly}> (opens in a new tab)</span></a> : <span className={styles.original}>An original idea</span>}
                {canManage && <div className={styles.actions}>
                  <button type="button" aria-label={`Edit ${idea.title}`} onClick={() => { setMessage(""); setDraft({ idea }); }}><Pencil size={15} aria-hidden="true" /><span>Edit</span></button>
                  <button type="button" aria-label={`Remove ${idea.title}`} onClick={() => { setRemoveError(""); setRemoving(idea); }}><Trash2 size={15} aria-hidden="true" /><span>Remove</span></button>
                </div>}
              </div>
              <p className={styles.author}>Saved by {memberName(idea.createdBy, members)}</p>
            </article>
          </li>;
        })}
      </ul>}
    </>}
    {draft && <IdeaForm tripId={tripId} members={members} selfId={selfId} idea={draft.idea} onClose={() => setDraft(null)} onSaved={saved} />}
    {removing && <Dialog title="Remove this idea?" busy={busy} onClose={() => setRemoving(null)}>
      <p>“{removing.title}” will be removed from the trip’s memory board.</p>
      {removeError && <Notice>{removeError}</Notice>}
      <div className="dialog-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={() => setRemoving(null)}>Keep idea</button>
        <button className="button destructive" type="button" disabled={busy} onClick={() => void remove()}>{busy ? <Busy text="Removing…" /> : "Remove idea"}</button>
      </div>
    </Dialog>}
  </section>;
}

export function ReelPanel(props: PanelProps) {
  const { user } = useSession();
  return user ? <ReelIdeas key={`${props.tripId}:${user.id}`} {...props} selfId={user.id} /> : null;
}
