import { randomUUID } from 'node:crypto';
import type { SqlClient } from './database.js';
import { ApiError, invalid, notFound } from './errors.js';
import { TripRepository } from './repository.js';
import type { ActivityComment, ActivityCommentInput } from './trip-planning-types.js';
import type { Role } from './types.js';

type CommentRow = Omit<ActivityComment, 'createdAt' | 'updatedAt'> & { createdAt: Date | string; updatedAt: Date | string };

const commentSelect = `SELECT c.id, c.trip_id AS "tripId", c.activity_id AS "activityId", c.author_id AS "authorId",
  p.display_name AS "authorDisplayName", c.body, c.created_at AS "createdAt", c.updated_at AS "updatedAt"
  FROM goa_core_activity_comments c
  JOIN goa_core_profiles p ON p.id = c.author_id`;
const asIso = (value: Date | string) => new Date(value).toISOString();
const denied = (message: string) => new ApiError(403, 'FORBIDDEN', message);

function constraintCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return '';
  return String((error as { code: unknown }).code);
}

function mapComment(row: CommentRow): ActivityComment {
  return {
    id: row.id,
    tripId: row.tripId,
    activityId: row.activityId,
    authorId: row.authorId.toLowerCase(),
    authorDisplayName: row.authorDisplayName,
    body: row.body,
    createdAt: asIso(row.createdAt),
    updatedAt: asIso(row.updatedAt),
  };
}

// Schema minLength counts a space. Store the trimmed text, and reject a blank comment.
function normalizeBody(input: ActivityCommentInput): string {
  if (typeof input?.body !== 'string') throw invalid('Write a comment.');
  const body = input.body.trim();
  if (!body || body.length > 2000) throw invalid('Write a comment.');
  return body;
}

export class CommentRepository {
  constructor(private readonly core: TripRepository) {}

  private async assertActivity(client: SqlClient, tripId: string, activityId: string): Promise<void> {
    const rows = await client.query('SELECT id FROM goa_core_activities WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE', [tripId, activityId]);
    if (!rows.length) throw notFound();
  }

  private async comment(client: SqlClient, tripId: string, activityId: string, commentId: string): Promise<ActivityComment> {
    const [row] = await client.query<CommentRow>(`${commentSelect}
      WHERE c.trip_id=$1 AND c.activity_id=$2 AND c.id=$3 AND c.deleted_at IS NULL
      FOR UPDATE OF c`, [tripId, activityId, commentId]);
    if (!row) throw notFound();
    return mapComment(row);
  }

  async listComments(actor: string, tripId: string, activityId: string): Promise<ActivityComment[]> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      await this.assertActivity(client, tripId, activityId);
      const rows = await client.query<CommentRow>(`${commentSelect}
        WHERE c.trip_id=$1 AND c.activity_id=$2 AND c.deleted_at IS NULL
        ORDER BY c.created_at ASC, c.id ASC`, [tripId, activityId]);
      return rows.map(mapComment);
    });
  }

  async createComment(actor: string, tripId: string, activityId: string, input: ActivityCommentInput): Promise<ActivityComment> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      await this.assertActivity(client, tripId, activityId);
      const body = normalizeBody(input);
      const id = randomUUID();
      try {
        await client.query(`INSERT INTO goa_core_activity_comments (id, trip_id, activity_id, author_id, body)
          VALUES ($1,$2,$3,$4,$5)`, [id, tripId, activityId, actor, body]);
      } catch (error) {
        if (constraintCode(error) === '23514') throw invalid('Write a comment.');
        if (constraintCode(error) === '23503') throw notFound();
        throw error;
      }
      await this.core.audit(client, actor, tripId, 'comment.created', id, null);
      return this.comment(client, tripId, activityId, id);
    });
  }

  async updateComment(actor: string, tripId: string, activityId: string, commentId: string, input: ActivityCommentInput): Promise<ActivityComment> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      await this.assertActivity(client, tripId, activityId);
      const current = await this.comment(client, tripId, activityId, commentId);
      if (current.authorId !== actor.toLowerCase()) throw denied('Only the author can edit this comment.');
      const body = normalizeBody(input);
      const updated = await client.query(`UPDATE goa_core_activity_comments SET body=$4, updated_at=now()
        WHERE trip_id=$1 AND activity_id=$2 AND id=$3 AND deleted_at IS NULL AND author_id=$5
        RETURNING id`, [tripId, activityId, commentId, body, actor]);
      if (!updated.length) throw notFound();
      await this.core.audit(client, actor, tripId, 'comment.updated', commentId, null);
      return this.comment(client, tripId, activityId, commentId);
    });
  }

  async deleteComment(actor: string, tripId: string, activityId: string, commentId: string): Promise<void> {
    return this.core.database.transaction(async (client) => {
      const role: Role = await this.core.membership(client, actor, tripId);
      await this.assertActivity(client, tripId, activityId);
      const current = await this.comment(client, tripId, activityId, commentId);
      if (current.authorId !== actor.toLowerCase() && role !== 'organiser') throw denied('Only the author or the organiser can remove this comment.');
      const removed = await client.query(`UPDATE goa_core_activity_comments SET deleted_at=now(), updated_at=now()
        WHERE trip_id=$1 AND activity_id=$2 AND id=$3 AND deleted_at IS NULL RETURNING id`, [tripId, activityId, commentId]);
      if (!removed.length) throw notFound();
      await this.core.audit(client, actor, tripId, 'comment.deleted', commentId, null);
    });
  }
}
