"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { MessageCircle } from "lucide-react";
import { api, core, type User } from "@/lib/client";
import type { ActivityComment } from "@/lib/trip-planning-types";
import { Busy, Dialog, Notice } from "./ui";
import styles from "./comments.module.css";

const commentTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "long",
});

const emptyComment = "Write a comment.";

function formatCommentTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "India time unavailable";
  const formatted = commentTime.format(date);
  return /india/i.test(formatted) ? formatted : `${formatted}, India time`;
}

function commentPurpose(comment: ActivityComment): string {
  const snippet = comment.body.replace(/\s+/g, " ").trim().slice(0, 80);
  return `${comment.authorDisplayName}: ${snippet}`;
}

function samePerson(left: string, right: string): boolean {
  return left !== "" && left.toLowerCase() === right.toLowerCase();
}

export function ActivityComments({ tripId, activityId, organiser }: { tripId: string; activityId: string; organiser: boolean }) {
  const headingId = useId();
  const composerId = useId();
  const [comments, setComments] = useState<ActivityComment[] | null>(null);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState("");
  const [formError, setFormError] = useState("");
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState<ActivityComment | null>(null);
  const [removing, setRemoving] = useState<ActivityComment | null>(null);
  const seen = useRef(`${tripId}\n${activityId}`);
  const generation = useRef(0);
  if (seen.current !== `${tripId}\n${activityId}`) {
    seen.current = `${tripId}\n${activityId}`;
    setComments(null);
    setUserId("");
    setLoadError("");
    setDraft("");
    setFormError("");
    setEditing(null);
    setRemoving(null);
    setLoading(true);
  }

  const base = `${core}/trips/${tripId}/activities/${activityId}/comments`;

  const load = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setLoadError("");
    try {
      const [list, profile] = await Promise.all([
        api<{ comments: ActivityComment[] }>(base),
        api<{ user: User }>(`${core}/me`),
      ]);
      if (generation.current !== current) return;
      const ordered = [...list.comments].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
      setComments(ordered);
      setUserId(profile.user.id);
    } catch (err) {
      if (generation.current !== current) return;
      setLoadError(err instanceof Error ? err.message : "Unable to load comments.");
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  const post = async (text: string) => {
    if (posting) return;
    setPosting(true);
    setFormError("");
    try {
      await api(base, { method: "POST", body: JSON.stringify({ body: text }) });
      setDraft("");
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Unable to post this comment.");
    } finally {
      setPosting(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) {
      setFormError(emptyComment);
      return;
    }
    void post(text);
  };

  const rejectEmpty = (event: FormEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    setFormError(emptyComment);
  };

  return <section className={styles.thread} aria-labelledby={headingId} aria-busy={loading}>
    <header className={styles.heading}>
      <span className={styles.kicker}><MessageCircle size={15} aria-hidden="true" /> NOTES</span>
      <h3 id={headingId}>Comments</h3>
      <p className={styles.lead}>Newest is last. Each time is India time.</p>
    </header>
    {loadError && <Notice>{loadError} <button type="button" className="text-button" onClick={() => void load()}>Retry</button></Notice>}
    {loading && comments === null ? <div className={styles.loading}><Busy text="Loading comments…" /></div> : null}
    {comments && comments.length === 0 && <p className={styles.empty}>No comments yet. Leave a note for the group.</p>}
    {comments && comments.length > 0 && <ol className={styles.list}>
      {comments.map((comment) => {
        const mine = samePerson(userId, comment.authorId);
        const canEdit = mine;
        const canDelete = mine || organiser;
        const edited = comment.updatedAt !== comment.createdAt;
        return <li key={comment.id}>
          <article className={styles.comment}>
            <div className={styles.meta}>
              <h4 className={styles.author}>{comment.authorDisplayName}</h4>
              <p className={styles.when}><time dateTime={comment.createdAt}>{formatCommentTime(comment.createdAt)}</time></p>
            </div>
            <p className={styles.body}>{comment.body}</p>
            {edited && <p className={styles.edited}>Edited <time dateTime={comment.updatedAt}>{formatCommentTime(comment.updatedAt)}</time></p>}
            {(canEdit || canDelete) && <div className={styles.actions}>
              {canEdit && <button className="button secondary" type="button" aria-label={`Edit comment by ${commentPurpose(comment)}`} onClick={() => { setRemoving(null); setEditing(comment); }}>Edit</button>}
              {canDelete && <button className="button secondary" type="button" aria-label={`Delete comment by ${commentPurpose(comment)}`} onClick={() => { setEditing(null); setRemoving(comment); }}>Delete</button>}
            </div>}
          </article>
        </li>
      })}
    </ol>}
    {comments && <form className={`premium-form ${styles.form}`} onSubmit={submit} autoComplete="off">
      <label htmlFor={composerId}>Add a comment
        <textarea id={composerId} name="body" required maxLength={2000} value={draft} aria-invalid={formError ? true : undefined} placeholder="A meeting time, a change of plan, or a reminder" onInvalid={rejectEmpty} onChange={(event) => { setDraft(event.target.value); if (formError) setFormError(""); }} />
      </label>
      {formError && <Notice>{formError} {draft.trim() && <button type="button" className="text-button" onClick={() => void post(draft.trim())}>Retry</button>}</Notice>}
      <button className="button primary" type="submit" disabled={posting}>{posting ? <Busy text="Posting…" /> : "Post comment"}</button>
    </form>}
    {editing && <EditComment key={editing.id} tripId={tripId} activityId={activityId} comment={editing} onClose={() => setEditing(null)} onSaved={load} />}
    {removing && <DeleteComment tripId={tripId} activityId={activityId} comment={removing} onClose={() => setRemoving(null)} onSaved={load} />}
  </section>;
}

function EditComment({ tripId, activityId, comment, onClose, onSaved }: {
  tripId: string;
  activityId: string;
  comment: ActivityComment;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const fieldId = useId();
  const [body, setBody] = useState(comment.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async (text: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`${core}/trips/${tripId}/activities/${activityId}/comments/${comment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ body: text }),
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save this comment.");
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = body.trim();
    if (!text) {
      setError(emptyComment);
      return;
    }
    void save(text);
  };

  return <Dialog title="Edit your comment" onClose={onClose} busy={busy}>
    <form className={`premium-form ${styles.form}`} onSubmit={submit} autoComplete="off">
      <label htmlFor={fieldId}>Comment
        <textarea id={fieldId} name="body" required maxLength={2000} autoFocus value={body} aria-invalid={error ? true : undefined} onInvalid={(event) => { event.preventDefault(); setError(emptyComment); }} onChange={(event) => { setBody(event.target.value); if (error) setError(""); }} />
      </label>
      {error && <Notice>{error} {body.trim() && <button type="button" className="text-button" onClick={() => void save(body.trim())}>Retry</button>}</Notice>}
      <div className="dialog-actions">
        <button className="button secondary" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="button primary" type="submit" disabled={busy}>{busy ? <Busy text="Saving…" /> : "Save comment"}</button>
      </div>
    </form>
  </Dialog>;
}

function DeleteComment({ tripId, activityId, comment, onClose, onSaved }: {
  tripId: string;
  activityId: string;
  comment: ActivityComment;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`${core}/trips/${tripId}/activities/${activityId}/comments/${comment.id}`, { method: "DELETE" });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete this comment.");
    } finally {
      setBusy(false);
    }
  };

  return <Dialog title="Delete this comment?" onClose={onClose} busy={busy}>
    <p>This removes {comment.authorDisplayName}&apos;s comment for everyone on the trip.</p>
    {error && <Notice>{error} <button type="button" className="text-button" onClick={() => void remove()}>Retry</button></Notice>}
    <div className="dialog-actions">
      <button className="button secondary" type="button" disabled={busy} onClick={onClose}>Keep comment</button>
      <button className="button primary" type="button" disabled={busy} aria-label={`Delete comment by ${commentPurpose(comment)}`} onClick={() => void remove()}>{busy ? <Busy text="Deleting…" /> : "Delete comment"}</button>
    </div>
  </Dialog>;
}
