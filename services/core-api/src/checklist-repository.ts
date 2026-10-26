import { randomUUID } from 'node:crypto';
import type { SqlClient } from './database.js';
import { ApiError, invalid, notFound } from './errors.js';
import { hash, TripRepository } from './repository.js';
import type { ChecklistItem, ChecklistItemInput, ChecklistPatch, ChecklistVisibility } from './trip-planning-types.js';
import type { Role } from './types.js';

export type ChecklistWrite = {
  visibility: ChecklistVisibility;
  title: string;
  assigneeUserId?: string | null;
};

type ChecklistRow = {
  id: string;
  tripId: string;
  visibility: ChecklistVisibility;
  title: string;
  assigneeUserId: string | null;
  completedAt: Date | string | null;
  createdBy: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const itemSelect = `SELECT id, trip_id AS "tripId", visibility, title, assignee_user_id AS "assigneeUserId",
  completed_at AS "completedAt", created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"
  FROM goa_core_checklist_items`;
const isoTimestamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const conflict = (message: string) => new ApiError(409, 'CONFLICT', message);
const denied = (message: string) => new ApiError(403, 'FORBIDDEN', message);
const asIso = (value: Date | string) => new Date(value).toISOString();

function constraintCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return '';
  return String((error as { code: unknown }).code);
}

function mapItem(row: ChecklistRow): ChecklistItem {
  return {
    id: row.id,
    tripId: row.tripId,
    visibility: row.visibility,
    title: row.title,
    assigneeUserId: row.assigneeUserId?.toLowerCase() ?? null,
    completedAt: row.completedAt == null ? null : asIso(row.completedAt),
    createdBy: row.createdBy.toLowerCase(),
    createdAt: asIso(row.createdAt),
    updatedAt: asIso(row.updatedAt),
  };
}

function normalizeCreate(input: ChecklistWrite): ChecklistItemInput {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw invalid('Give the item a title.');
  if (input.visibility !== 'personal' && input.visibility !== 'shared') throw invalid('Choose a personal or shared item.');
  const rawAssignee = input.assigneeUserId ?? null;
  if (rawAssignee !== null && typeof rawAssignee !== 'string') throw invalid('Choose an accepted member, or leave the item unassigned.');
  const assigneeUserId = rawAssignee === null ? null : rawAssignee.toLowerCase();
  if (input.visibility === 'personal' && assigneeUserId !== null) throw invalid('A personal item cannot have an assignee.');
  return { visibility: input.visibility, title, assigneeUserId };
}

function parseCompletedAt(value: string): string {
  const trimmed = value.trim();
  const match = isoTimestamp.exec(trimmed);
  if (!match) throw invalid('Use a valid completion time.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) throw invalid('Use a valid completion time.');
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) throw invalid('Use a valid completion time.');
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) throw invalid('Use a valid completion time.');
  return parsed.toISOString();
}

export class ChecklistRepository {
  constructor(private readonly core: TripRepository) {}

  private async priorWrite(client: SqlClient, actor: string, tripId: string, key: string | undefined, input: ChecklistItemInput): Promise<string | undefined> {
    if (!key) return undefined;
    const digest = hash(JSON.stringify(input));
    await client.query(`INSERT INTO goa_core_write_idempotency (actor_id,trip_id,scope,request_key,request_hash)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [actor, tripId, 'checklist', key, digest]);
    const [row] = await client.query<{ request_hash: string; target_id: string | null }>(`SELECT request_hash,target_id FROM goa_core_write_idempotency
      WHERE actor_id=$1 AND trip_id=$2 AND scope=$3 AND request_key=$4 FOR UPDATE`, [actor, tripId, 'checklist', key]);
    if (row!.request_hash !== digest) throw conflict('This retry key was used for different information.');
    return row!.target_id ?? undefined;
  }

  private async finishWrite(client: SqlClient, actor: string, tripId: string, key: string | undefined, id: string): Promise<void> {
    if (key) await client.query(`UPDATE goa_core_write_idempotency SET target_id=$5 WHERE actor_id=$1 AND trip_id=$2 AND scope=$3 AND request_key=$4`, [actor, tripId, 'checklist', key, id]);
  }

  private async assertAssignee(client: SqlClient, tripId: string, assigneeUserId: string | null): Promise<void> {
    if (assigneeUserId === null) return;
    const [row] = await client.query<{ status: string }>('SELECT status FROM goa_core_memberships WHERE trip_id=$1 AND user_id=$2 FOR UPDATE', [tripId, assigneeUserId]);
    if (row?.status !== 'accepted') throw invalid('Choose an accepted member, or leave the item unassigned.');
  }

  // Personal rows are visible only to their creator. The organiser gets the same 404 as a missing row.
  private async visibleItem(client: SqlClient, actor: string, tripId: string, itemId: string): Promise<ChecklistItem> {
    const [row] = await client.query<ChecklistRow>(`${itemSelect} WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL
      AND (visibility='shared' OR created_by=$3) FOR UPDATE`, [tripId, itemId, actor]);
    if (!row) throw notFound();
    return mapItem(row);
  }

  private denyUnlessCreatorOrOrganiser(item: ChecklistItem, actor: string, role: Role): void {
    if (item.createdBy !== actor && role !== 'organiser') throw denied('Only the creator or the organiser can change this item.');
  }

  private denyUnlessAssigneeOrOrganiser(item: ChecklistItem, actor: string, role: Role): void {
    if (item.assigneeUserId !== actor && role !== 'organiser') throw denied('Only the assignee or the organiser can mark this packed.');
  }

  async listItems(actor: string, tripId: string): Promise<ChecklistItem[]> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      const rows = await client.query<ChecklistRow>(`${itemSelect} WHERE trip_id=$1 AND deleted_at IS NULL
        AND (visibility='shared' OR created_by=$2)
        ORDER BY CASE visibility WHEN 'personal' THEN 0 ELSE 1 END,
          CASE WHEN completed_at IS NULL THEN 0 ELSE 1 END, created_at, id`, [tripId, actor]);
      return rows.map(mapItem);
    });
  }

  async createItem(actor: string, tripId: string, input: ChecklistWrite, key?: string): Promise<ChecklistItem> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      const normalized = normalizeCreate(input);
      await this.assertAssignee(client, tripId, normalized.assigneeUserId);
      const prior = await this.priorWrite(client, actor, tripId, key, normalized);
      if (prior) return this.visibleItem(client, actor, tripId, prior);
      const id = randomUUID();
      try {
        await client.query(`INSERT INTO goa_core_checklist_items (id,trip_id,visibility,title,assignee_user_id,created_by)
          VALUES ($1,$2,$3,$4,$5,$6)`, [id, tripId, normalized.visibility, normalized.title, normalized.assigneeUserId, actor]);
      } catch (error) {
        if (constraintCode(error) === '23514') throw invalid('A personal item cannot have an assignee.');
        if (constraintCode(error) === '23503') throw invalid('Choose an accepted member, or leave the item unassigned.');
        throw error;
      }
      await this.finishWrite(client, actor, tripId, key, id);
      await this.core.audit(client, actor, tripId, 'checklist.created', id, null);
      return this.visibleItem(client, actor, tripId, id);
    });
  }

  async updateItem(actor: string, tripId: string, itemId: string, patch: ChecklistPatch): Promise<ChecklistItem> {
    return this.core.database.transaction(async (client) => {
      const role = await this.core.membership(client, actor, tripId);
      const current = await this.visibleItem(client, actor, tripId, itemId);
      if (current.visibility === 'shared') {
        if (patch.title !== undefined || patch.assigneeUserId !== undefined) this.denyUnlessCreatorOrOrganiser(current, actor, role);
        if (patch.completedAt !== undefined) this.denyUnlessAssigneeOrOrganiser(current, actor, role);
      }
      let title = current.title;
      let assigneeUserId = current.assigneeUserId;
      let completedAt = current.completedAt;
      if (patch.title !== undefined) {
        if (typeof patch.title !== 'string') throw invalid('Give the item a title.');
        title = patch.title.trim();
        if (!title) throw invalid('Give the item a title.');
      }
      if (patch.assigneeUserId !== undefined) {
        if (current.visibility === 'personal') {
          if (patch.assigneeUserId !== null) throw invalid('A personal item cannot have an assignee.');
          assigneeUserId = null;
        } else {
          assigneeUserId = patch.assigneeUserId === null ? null : patch.assigneeUserId.toLowerCase();
          await this.assertAssignee(client, tripId, assigneeUserId);
        }
      }
      if (patch.completedAt !== undefined) {
        if (patch.completedAt === null) completedAt = null;
        else if (typeof patch.completedAt === 'string') completedAt = parseCompletedAt(patch.completedAt);
        else throw invalid('Use a valid completion time.');
      }
      try {
        const updated = await client.query(`UPDATE goa_core_checklist_items SET title=$3, assignee_user_id=$4, completed_at=$5, updated_at=now()
          WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id`, [tripId, itemId, title, assigneeUserId, completedAt]);
        if (!updated.length) throw notFound();
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (constraintCode(error) === '23514') throw invalid('A personal item cannot have an assignee.');
        if (constraintCode(error) === '23503') throw invalid('Choose an accepted member, or leave the item unassigned.');
        throw error;
      }
      const completing = current.completedAt === null && completedAt !== null;
      const titleChanged = title !== current.title;
      const assigneeChanged = assigneeUserId !== current.assigneeUserId;
      const completionMoved = current.completedAt !== completedAt && !completing;
      if (completing) await this.core.audit(client, actor, tripId, 'checklist.completed', itemId, null);
      if (titleChanged || assigneeChanged || completionMoved || !completing) await this.core.audit(client, actor, tripId, 'checklist.updated', itemId, null);
      return this.visibleItem(client, actor, tripId, itemId);
    });
  }

  async deleteItem(actor: string, tripId: string, itemId: string): Promise<void> {
    return this.core.database.transaction(async (client) => {
      const role = await this.core.membership(client, actor, tripId);
      const current = await this.visibleItem(client, actor, tripId, itemId);
      if (current.visibility === 'shared' && current.createdBy !== actor && role !== 'organiser') {
        throw denied('Only the creator or the organiser can remove this item.');
      }
      const removed = await client.query(`UPDATE goa_core_checklist_items SET deleted_at=now(),updated_at=now()
        WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id`, [tripId, itemId]);
      if (!removed.length) throw notFound();
      await this.core.audit(client, actor, tripId, 'checklist.deleted', itemId, null);
    });
  }
}
