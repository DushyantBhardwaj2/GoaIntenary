import { randomUUID } from 'node:crypto';
import { uuidPattern } from './auth.js';
import type { SqlClient } from './database.js';
import { ApiError, invalid, notFound } from './errors.js';
import { hash, TripRepository } from './repository.js';
import type { Booking, BookingInput, BookingTargetType } from './trip-planning-types.js';

export type BookingWrite = {
  targetType: BookingTargetType;
  targetId: string;
  providerName?: string;
  reference?: string;
  notes?: string;
};

type BookingRow = Omit<Booking, 'createdAt' | 'updatedAt'> & { createdAt: Date | string; updatedAt: Date | string };

const bookingSelect = `SELECT id, trip_id AS "tripId", target_type AS "targetType", target_id AS "targetId",
  provider_name AS "providerName", "reference", notes, created_by AS "createdBy",
  created_at AS "createdAt", updated_at AS "updatedAt" FROM goa_core_bookings`;
const conflict = (message: string) => new ApiError(409, 'CONFLICT', message);
const targetTables: Record<BookingTargetType, { table: string; message: string }> = {
  activity: { table: 'goa_core_activities', message: 'Choose an activity on this trip.' },
  stay: { table: 'goa_core_stays', message: 'Choose a stay on this trip.' },
  travel: { table: 'goa_core_travel_segments', message: 'Choose a travel segment on this trip.' },
};

function mapBooking(row: BookingRow): Booking {
  return {
    id: row.id, tripId: row.tripId, targetType: row.targetType, targetId: row.targetId,
    providerName: row.providerName, reference: row.reference, notes: row.notes, createdBy: row.createdBy,
    createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function normalize(input: BookingWrite): BookingInput {
  const target = targetTables[input.targetType];
  const targetId = typeof input.targetId === 'string' ? input.targetId.trim().toLowerCase() : '';
  if (!target || !uuidPattern.test(targetId)) throw invalid('Choose an activity, stay, or travel segment on this trip.');
  const providerName = (input.providerName ?? '').trim();
  const reference = (input.reference ?? '').trim();
  const notes = (input.notes ?? '').trim();
  if (providerName.length > 160 || reference.length > 80 || notes.length > 2000) throw invalid();
  return { targetType: input.targetType, targetId, providerName, reference, notes };
}

function constraintDetails(error: unknown, depth = 0): { code: string; constraint: string } {
  if (depth > 4 || typeof error !== 'object' || error === null) return { code: '', constraint: '' };
  const record = error as { code?: unknown; constraint?: unknown; constraint_name?: unknown; cause?: unknown };
  const code = record.code === undefined ? '' : String(record.code);
  const constraint = String(record.constraint ?? record.constraint_name ?? '');
  if (code || constraint) return { code, constraint };
  return constraintDetails(record.cause, depth + 1);
}

function liveTargetTaken(error: unknown): boolean {
  const { code, constraint } = constraintDetails(error);
  return code === '23505' && (constraint === '' || constraint === 'goa_core_bookings_live_target');
}

export class BookingRepository {
  constructor(private readonly core: TripRepository) {}

  private async priorWrite(client: SqlClient, actor: string, tripId: string, key: string | undefined, input: BookingInput): Promise<string | undefined> {
    if (!key) return undefined;
    const digest = hash(JSON.stringify(input));
    await client.query(`INSERT INTO goa_core_write_idempotency (actor_id,trip_id,scope,request_key,request_hash)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [actor, tripId, 'booking', key, digest]);
    const [row] = await client.query<{ request_hash: string; target_id: string | null }>(`SELECT request_hash,target_id FROM goa_core_write_idempotency
      WHERE actor_id=$1 AND trip_id=$2 AND scope=$3 AND request_key=$4 FOR UPDATE`, [actor, tripId, 'booking', key]);
    if (row!.request_hash !== digest) throw conflict('This retry key was used for different information.');
    return row!.target_id ?? undefined;
  }

  private async finishWrite(client: SqlClient, actor: string, tripId: string, key: string | undefined, id: string): Promise<void> {
    if (key) await client.query(`UPDATE goa_core_write_idempotency SET target_id=$5 WHERE actor_id=$1 AND trip_id=$2 AND scope=$3 AND request_key=$4`, [actor, tripId, 'booking', key, id]);
  }

  private async liveBooking(client: SqlClient, tripId: string, bookingId: string): Promise<BookingRow> {
    const [row] = await client.query<BookingRow>(`${bookingSelect} WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`, [tripId, bookingId]);
    if (!row) throw notFound();
    return row;
  }

  private async assertTarget(client: SqlClient, tripId: string, input: BookingInput): Promise<void> {
    const target = targetTables[input.targetType];
    const rows = await client.query(`SELECT id FROM ${target.table} WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`, [tripId, input.targetId]);
    if (!rows.length) throw invalid(target.message);
  }

  private async assertAvailable(client: SqlClient, tripId: string, input: BookingInput, bookingId?: string): Promise<void> {
    const rows = await client.query<{ id: string }>(`SELECT id FROM goa_core_bookings
      WHERE trip_id=$1 AND target_type=$2 AND target_id=$3 AND deleted_at IS NULL AND ($4::uuid IS NULL OR id <> $4::uuid) FOR UPDATE`,
    [tripId, input.targetType, input.targetId, bookingId ?? null]);
    if (rows.length) throw conflict('This activity, stay, or travel segment already has a booking.');
  }

  private async insertBooking(client: SqlClient, actor: string, tripId: string, id: string, input: BookingInput): Promise<void> {
    try {
      await client.query(`INSERT INTO goa_core_bookings (id,trip_id,target_type,target_id,provider_name,reference,notes,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, tripId, input.targetType, input.targetId, input.providerName, input.reference, input.notes, actor]);
    } catch (error) {
      if (liveTargetTaken(error)) throw conflict('This activity, stay, or travel segment already has a booking.');
      throw error;
    }
  }

  async listBookings(actor: string, tripId: string): Promise<Booking[]> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      return (await client.query<BookingRow>(`${bookingSelect} WHERE trip_id=$1 AND deleted_at IS NULL ORDER BY created_at, id`, [tripId])).map(mapBooking);
    });
  }

  async createBooking(actor: string, tripId: string, input: BookingWrite, key?: string): Promise<Booking> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      const normalized = normalize(input);
      const prior = await this.priorWrite(client, actor, tripId, key, normalized);
      if (prior) return mapBooking(await this.liveBooking(client, tripId, prior));
      await this.assertTarget(client, tripId, normalized);
      await this.assertAvailable(client, tripId, normalized);
      const id = randomUUID();
      await this.insertBooking(client, actor, tripId, id, normalized);
      await this.finishWrite(client, actor, tripId, key, id);
      await this.core.audit(client, actor, tripId, 'booking.created', id, null);
      return mapBooking(await this.liveBooking(client, tripId, id));
    });
  }

  async updateBooking(actor: string, tripId: string, bookingId: string, input: BookingWrite): Promise<Booking> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      await this.liveBooking(client, tripId, bookingId);
      const normalized = normalize(input);
      await this.assertTarget(client, tripId, normalized);
      await this.assertAvailable(client, tripId, normalized, bookingId);
      try {
        const updated = await client.query(`UPDATE goa_core_bookings SET target_type=$3,target_id=$4,provider_name=$5,reference=$6,notes=$7,updated_at=now()
          WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id`,
        [tripId, bookingId, normalized.targetType, normalized.targetId, normalized.providerName, normalized.reference, normalized.notes]);
        if (!updated.length) throw notFound();
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (liveTargetTaken(error)) throw conflict('This activity, stay, or travel segment already has a booking.');
        throw error;
      }
      await this.core.audit(client, actor, tripId, 'booking.updated', bookingId, null);
      return mapBooking(await this.liveBooking(client, tripId, bookingId));
    });
  }

  async deleteBooking(actor: string, tripId: string, bookingId: string): Promise<void> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      const removed = await client.query(`UPDATE goa_core_bookings SET deleted_at=now(),updated_at=now()
        WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id`, [tripId, bookingId]);
      if (!removed.length) throw notFound();
      await this.core.audit(client, actor, tripId, 'booking.deleted', bookingId, null);
    });
  }
}
