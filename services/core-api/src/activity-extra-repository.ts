import type { SqlClient } from './database.js';
import { ApiError, invalid, notFound } from './errors.js';
import type { TripRepository } from './repository.js';
import type { ActivityAttendees, ActivityStatus, ActivityStatusInput, ActivityStatusValue } from './trip-planning-types.js';

const statuses = ['planned', 'confirmed', 'cancelled'] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type StatusRow = {
  activityId: string;
  tripId: string;
  status: string;
  updatedBy: string | null;
  updatedAt: Date | string | null;
};

function constraintCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return '';
  return String((error as { code: unknown }).code);
}

function isStatus(value: string): value is ActivityStatusValue {
  return (statuses as readonly string[]).includes(value);
}

function asIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function normalizeIds(participantIds: unknown): string[] {
  if (!Array.isArray(participantIds)) throw invalid('Choose people from this trip.');
  const ids = participantIds.map((id) => {
    if (typeof id !== 'string' || !uuidPattern.test(id)) throw invalid('Choose people from this trip.');
    return id.toLowerCase();
  });
  if (new Set(ids).size !== ids.length) throw invalid('Choose each person only once.');
  if (ids.length > 50) throw invalid('Choose at most 50 people.');
  return [...ids].sort();
}

function mapStatus(row: StatusRow | undefined, activityId: string, tripId: string): ActivityStatus {
  if (!row) return { activityId, tripId, status: 'planned', updatedBy: null, updatedAt: null };
  if (!isStatus(row.status)) throw invalid('Choose planned, confirmed, or cancelled.');
  return {
    activityId: String(row.activityId).toLowerCase(),
    tripId: String(row.tripId).toLowerCase(),
    status: row.status,
    updatedBy: row.updatedBy ? String(row.updatedBy).toLowerCase() : null,
    updatedAt: row.updatedAt ? asIso(row.updatedAt) : null,
  };
}

export class ActivityExtraRepository {
  constructor(private readonly core: TripRepository) {}

  private async assertActivity(client: SqlClient, tripId: string, activityId: string): Promise<void> {
    const rows = await client.query(
      'SELECT id FROM goa_core_activities WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE',
      [tripId, activityId],
    );
    if (!rows.length) throw notFound();
  }

  private async readAttendees(client: SqlClient, tripId: string, activityId: string): Promise<ActivityAttendees> {
    const rows = await client.query<{ participantId: string }>(
      `SELECT participant_id::text AS "participantId"
       FROM goa_core_activity_attendees WHERE trip_id=$1 AND activity_id=$2 ORDER BY participant_id`,
      [tripId, activityId],
    );
    return { participantIds: rows.map((row) => row.participantId.toLowerCase()) };
  }

  private async replaceAttendees(client: SqlClient, tripId: string, activityId: string, participantIds: string[]): Promise<void> {
    if (participantIds.length) {
      const rows = await client.query<{ id: string }>('SELECT id::text AS id FROM goa_core_expense_participants WHERE trip_id=$1', [tripId]);
      const known = new Set(rows.map((row) => row.id.toLowerCase()));
      if (participantIds.some((id) => !known.has(id))) throw invalid('Choose people from this trip.');
    }
    await client.query('DELETE FROM goa_core_activity_attendees WHERE trip_id=$1 AND activity_id=$2', [tripId, activityId]);
    for (const participantId of participantIds) {
      try {
        await client.query(
          'INSERT INTO goa_core_activity_attendees (trip_id, activity_id, participant_id) VALUES ($1,$2,$3)',
          [tripId, activityId, participantId],
        );
      } catch (error) {
        if (error instanceof ApiError) throw error;
        const code = constraintCode(error);
        if (code === '23503' || code === '23505' || code === '22P02') throw invalid('Choose people from this trip.');
        throw error;
      }
    }
  }

  async getStatus(actor: string, tripId: string, activityId: string): Promise<ActivityStatus> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      await this.assertActivity(client, tripId, activityId);
      const [row] = await client.query<StatusRow>(
        `SELECT activity_id AS "activityId", trip_id AS "tripId", status, updated_by AS "updatedBy", updated_at AS "updatedAt"
         FROM goa_core_activity_status WHERE trip_id=$1 AND activity_id=$2`,
        [tripId, activityId],
      );
      return mapStatus(row, activityId.toLowerCase(), tripId.toLowerCase());
    });
  }

  async setStatus(actor: string, tripId: string, activityId: string, input: ActivityStatusInput): Promise<ActivityStatus> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      await this.assertActivity(client, tripId, activityId);
      if (!isStatus(input?.status)) throw invalid('Choose planned, confirmed, or cancelled.');
      try {
        const [row] = await client.query<StatusRow>(
          `INSERT INTO goa_core_activity_status (activity_id, trip_id, status, updated_by)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (activity_id) DO UPDATE SET status=EXCLUDED.status, updated_by=EXCLUDED.updated_by, updated_at=now()
           RETURNING activity_id AS "activityId", trip_id AS "tripId", status, updated_by AS "updatedBy", updated_at AS "updatedAt"`,
          [activityId, tripId, input.status, actor],
        );
        if (!row) throw invalid('The status could not be saved.');
        await this.core.audit(client, actor, tripId, 'activity_status.updated', activityId, null);
        return mapStatus(row, activityId.toLowerCase(), tripId.toLowerCase());
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (constraintCode(error) === '23514') throw invalid('Choose planned, confirmed, or cancelled.');
        if (constraintCode(error) === '23503') throw notFound();
        throw error;
      }
    });
  }

  async getAttendees(actor: string, tripId: string, activityId: string): Promise<ActivityAttendees> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      await this.assertActivity(client, tripId, activityId);
      return this.readAttendees(client, tripId, activityId);
    });
  }

  async setAttendees(actor: string, tripId: string, activityId: string, input: ActivityAttendees): Promise<ActivityAttendees> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      await this.assertActivity(client, tripId, activityId);
      const participantIds = normalizeIds(input?.participantIds);
      await this.replaceAttendees(client, tripId, activityId, participantIds);
      await this.core.audit(client, actor, tripId, 'activity_attendees.updated', activityId, null);
      return this.readAttendees(client, tripId, activityId);
    });
  }
}
