import { randomUUID } from 'node:crypto';
import { uuidPattern } from './auth.js';
import type { SqlClient } from './database.js';
import { ApiError, invalid, notFound } from './errors.js';
import { hash, TripRepository } from './repository.js';
import type { Stay, StayInput } from './trip-planning-types.js';

export type StayBody = Partial<StayInput> & Pick<StayInput, 'propertyName' | 'checkIn' | 'checkOut' | 'guestIds'>;

type StayRow = {
  id: string;
  tripId: string;
  propertyName: string;
  address: string;
  latitude: number | string | null;
  longitude: number | string | null;
  checkIn: Date | string;
  checkOut: Date | string;
  phone: string;
  contactName: string;
  notes: string;
  createdBy: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const stayColumns = `SELECT id, trip_id AS "tripId", property_name AS "propertyName", address, latitude, longitude,
  check_in AS "checkIn", check_out AS "checkOut", phone, contact_name AS "contactName", notes,
  created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt" FROM goa_core_stays`;
const conflict = (message: string) => new ApiError(409, 'CONFLICT', message);

function asIso(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw invalid('Use a real check-in and check-out time.');
  return date.toISOString();
}

function asCoordinate(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function mapStay(row: StayRow, guestIds: string[]): Stay {
  return {
    id: row.id,
    tripId: row.tripId,
    propertyName: row.propertyName,
    address: row.address,
    latitude: asCoordinate(row.latitude),
    longitude: asCoordinate(row.longitude),
    checkIn: asIso(row.checkIn),
    checkOut: asIso(row.checkOut),
    phone: row.phone,
    contactName: row.contactName,
    notes: row.notes,
    guestIds,
    createdBy: row.createdBy,
    createdAt: asIso(row.createdAt),
    updatedAt: asIso(row.updatedAt),
  };
}

function instant(value: string | undefined): Date | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function normalizeStay(input: StayBody): StayInput {
  if (typeof input.propertyName !== 'string' || !input.propertyName.trim()) throw invalid('Give the stay a property name.');
  const latitude = input.latitude ?? null;
  const longitude = input.longitude ?? null;
  if ((latitude === null) !== (longitude === null)) throw invalid('Supply both latitude and longitude, or leave both empty.');
  if (latitude !== null && (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)) {
    throw invalid('Use latitude from -90 to 90 and longitude from -180 to 180.');
  }
  const checkIn = instant(input.checkIn);
  const checkOut = instant(input.checkOut);
  if (!checkIn || !checkOut) throw invalid('Use a real check-in and check-out time.');
  if (checkOut.getTime() <= checkIn.getTime()) throw invalid('Check-out must be later than check-in.');
  if (!Array.isArray(input.guestIds)) throw invalid('Choose guests from this trip.');
  const guestIds = input.guestIds.map((id) => id.toLowerCase());
  if (guestIds.some((id) => !uuidPattern.test(id))) throw invalid('Choose guests from this trip.');
  if (new Set(guestIds).size !== guestIds.length) throw invalid('List each guest once.');
  return {
    propertyName: input.propertyName.trim(),
    address: input.address ?? '',
    latitude,
    longitude,
    checkIn: checkIn.toISOString(),
    checkOut: checkOut.toISOString(),
    phone: input.phone ?? '',
    contactName: input.contactName ?? '',
    notes: input.notes ?? '',
    guestIds: [...guestIds].sort(),
  };
}

function constraintCode(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('code' in error)) return '';
  return String((error as { code: unknown }).code);
}

export class StayRepository {
  constructor(private readonly core: TripRepository) {}

  private async priorWrite(client: SqlClient, actor: string, tripId: string, key: string | undefined, input: StayInput): Promise<string | undefined> {
    if (!key) return undefined;
    const digest = hash(JSON.stringify(input));
    await client.query(`INSERT INTO goa_core_write_idempotency (actor_id,trip_id,scope,request_key,request_hash)
      VALUES ($1,$2,'stay',$3,$4) ON CONFLICT DO NOTHING`, [actor, tripId, key, digest]);
    const [row] = await client.query<{ request_hash: string; target_id: string | null }>(`SELECT request_hash,target_id FROM goa_core_write_idempotency
      WHERE actor_id=$1 AND trip_id=$2 AND scope='stay' AND request_key=$3 FOR UPDATE`, [actor, tripId, key]);
    if (row!.request_hash !== digest) throw conflict('This retry key was used for different information.');
    return row!.target_id ?? undefined;
  }

  private async finishWrite(client: SqlClient, actor: string, tripId: string, key: string | undefined, id: string): Promise<void> {
    if (key) await client.query(`UPDATE goa_core_write_idempotency SET target_id=$4 WHERE actor_id=$1 AND trip_id=$2 AND scope='stay' AND request_key=$3`, [actor, tripId, key, id]);
  }

  private async guestIds(client: SqlClient, tripId: string, stayId: string): Promise<string[]> {
    const rows = await client.query<{ participantId: string }>(`SELECT participant_id::text AS "participantId" FROM goa_core_stay_guests
      WHERE trip_id=$1 AND stay_id=$2 ORDER BY participant_id`, [tripId, stayId]);
    return rows.map((row) => row.participantId.toLowerCase());
  }

  private async stay(client: SqlClient, tripId: string, stayId: string): Promise<Stay> {
    const [row] = await client.query<StayRow>(`${stayColumns} WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL`, [tripId, stayId]);
    if (!row) throw notFound();
    return mapStay(row, await this.guestIds(client, tripId, stayId));
  }

  private async stays(client: SqlClient, tripId: string): Promise<Stay[]> {
    const rows = await client.query<StayRow>(`${stayColumns} WHERE trip_id=$1 AND deleted_at IS NULL ORDER BY check_in ASC, id ASC`, [tripId]);
    const guests = await client.query<{ stayId: string; participantId: string }>(`SELECT stay_id::text AS "stayId", participant_id::text AS "participantId"
      FROM goa_core_stay_guests WHERE trip_id=$1 ORDER BY participant_id`, [tripId]);
    const byStay = new Map<string, string[]>();
    for (const guest of guests) {
      const key = guest.stayId.toLowerCase();
      const list = byStay.get(key) ?? [];
      list.push(guest.participantId.toLowerCase());
      byStay.set(key, list);
    }
    for (const list of byStay.values()) list.sort();
    return rows.map((row) => mapStay(row, byStay.get(row.id.toLowerCase()) ?? []));
  }

  private async assertGuests(client: SqlClient, tripId: string, guestIds: string[]): Promise<void> {
    if (!guestIds.length) return;
    const rows = await client.query<{ id: string }>('SELECT id::text AS id FROM goa_core_expense_participants WHERE trip_id=$1', [tripId]);
    const known = new Set(rows.map((row) => row.id.toLowerCase()));
    if (guestIds.some((id) => !known.has(id))) throw invalid('Choose guests from this trip.');
  }

  private async replaceGuests(client: SqlClient, tripId: string, stayId: string, guestIds: string[]): Promise<void> {
    await this.assertGuests(client, tripId, guestIds);
    await client.query('DELETE FROM goa_core_stay_guests WHERE trip_id=$1 AND stay_id=$2', [tripId, stayId]);
    for (const participantId of guestIds) {
      try {
        await client.query('INSERT INTO goa_core_stay_guests (trip_id,stay_id,participant_id) VALUES ($1,$2,$3)', [tripId, stayId, participantId]);
      } catch (error) {
        if (constraintCode(error) === '23503' || constraintCode(error) === '23505') throw invalid('Choose guests from this trip.');
        throw error;
      }
    }
  }

  async list(actor: string, tripId: string): Promise<Stay[]> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      return this.stays(client, tripId);
    });
  }

  async create(actor: string, tripId: string, input: StayBody, key?: string): Promise<Stay> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      const normalized = normalizeStay(input);
      const prior = await this.priorWrite(client, actor, tripId, key, normalized);
      if (prior) return this.stay(client, tripId, prior);
      await this.assertGuests(client, tripId, normalized.guestIds);
      const id = randomUUID();
      try {
        await client.query(`INSERT INTO goa_core_stays (id,trip_id,property_name,address,latitude,longitude,check_in,check_out,phone,contact_name,notes,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id, tripId, normalized.propertyName, normalized.address, normalized.latitude, normalized.longitude,
          normalized.checkIn, normalized.checkOut, normalized.phone, normalized.contactName, normalized.notes, actor]);
      } catch (error) {
        if (constraintCode(error) === '23514') throw invalid('Check the stay times and coordinates.');
        throw error;
      }
      await this.replaceGuests(client, tripId, id, normalized.guestIds);
      await this.finishWrite(client, actor, tripId, key, id);
      await this.core.audit(client, actor, tripId, 'stay.created', id, null);
      return this.stay(client, tripId, id);
    });
  }

  async update(actor: string, tripId: string, stayId: string, input: StayBody): Promise<Stay> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      const normalized = normalizeStay(input);
      const current = await client.query('SELECT id FROM goa_core_stays WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE', [tripId, stayId]);
      if (!current.length) throw notFound();
      try {
        const updated = await client.query(`UPDATE goa_core_stays SET property_name=$3,address=$4,latitude=$5,longitude=$6,check_in=$7,check_out=$8,
          phone=$9,contact_name=$10,notes=$11,updated_at=now() WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id`,
        [tripId, stayId, normalized.propertyName, normalized.address, normalized.latitude, normalized.longitude, normalized.checkIn, normalized.checkOut,
          normalized.phone, normalized.contactName, normalized.notes]);
        if (!updated.length) throw notFound();
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (constraintCode(error) === '23514') throw invalid('Check the stay times and coordinates.');
        throw error;
      }
      await this.replaceGuests(client, tripId, stayId, normalized.guestIds);
      await this.core.audit(client, actor, tripId, 'stay.updated', stayId, null);
      return this.stay(client, tripId, stayId);
    });
  }

  async remove(actor: string, tripId: string, stayId: string): Promise<void> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      const rows = await client.query('UPDATE goa_core_stays SET deleted_at=now(),updated_at=now() WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id', [tripId, stayId]);
      if (!rows.length) throw notFound();
      await this.core.audit(client, actor, tripId, 'stay.deleted', stayId, null);
    });
  }
}
