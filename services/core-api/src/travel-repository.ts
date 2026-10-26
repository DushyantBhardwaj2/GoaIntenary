import { randomUUID } from 'node:crypto';
import type { SqlClient } from './database.js';
import { ApiError, invalid, notFound } from './errors.js';
import { hash, TripRepository } from './repository.js';
import type { TravelMode, TravelSegment, TravelSegmentInput } from './trip-planning-types.js';

export type TravelWrite = {
  mode: TravelMode;
  title: string;
  departurePlace: string;
  arrivalPlace: string;
  departureAt: string;
  arrivalAt?: string | null;
  departureTerminal?: string;
  arrivalTerminal?: string;
  bookingReference?: string;
  notes?: string;
  travellerIds: string[];
};

type SegmentRow = {
  id: string;
  tripId: string;
  mode: TravelMode;
  title: string;
  departurePlace: string;
  arrivalPlace: string;
  departureAt: Date | string;
  arrivalAt: Date | string | null;
  departureTerminal: string;
  arrivalTerminal: string;
  bookingReference: string;
  notes: string;
  createdBy: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
};

const segmentSelect = `SELECT id, trip_id AS "tripId", mode, title, departure_place AS "departurePlace",
  arrival_place AS "arrivalPlace", departure_at AS "departureAt", arrival_at AS "arrivalAt",
  departure_terminal AS "departureTerminal", arrival_terminal AS "arrivalTerminal",
  booking_reference AS "bookingReference", notes, created_by AS "createdBy",
  created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
  FROM goa_core_travel_segments`;
const conflict = (message: string) => new ApiError(409, 'CONFLICT', message);
const instantPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-](\d{2}):(\d{2}))$/;

function instant(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Unable to complete this request. Please try again.');
  return date.toISOString();
}

function parseInstant(value: string, label: 'departure' | 'arrival'): Date {
  const trimmed = value.trim();
  const match = instantPattern.exec(trimmed);
  if (!match) throw invalid(`Use a valid ${label} time.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const offsetHours = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinutes = match[10] === undefined ? 0 : Number(match[10]);
  if (year < 1 || hour > 23 || minute > 59 || second > 59 || offsetHours > 23 || offsetMinutes > 59 || month < 1 || month > 12) {
    throw invalid(`Use a valid ${label} time.`);
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw invalid(`Use a valid ${label} time.`);
  }
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) throw invalid(`Use a valid ${label} time.`);
  return parsed;
}

function requiredText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw invalid(message);
  return trimmed;
}

function normalizeTravel(input: TravelWrite): TravelSegmentInput {
  const title = requiredText(input.title, 'Give the segment a title.');
  const departurePlace = requiredText(input.departurePlace, 'Name the departure place.');
  const arrivalPlace = requiredText(input.arrivalPlace, 'Name the arrival place.');
  const departure = parseInstant(input.departureAt, 'departure');
  const arrival = input.arrivalAt == null ? null : parseInstant(input.arrivalAt, 'arrival');
  if (arrival && arrival.getTime() < departure.getTime()) throw invalid('Arrival must be at the same time as departure or later.');
  const travellerIds = input.travellerIds.map((id) => id.toLowerCase());
  if (new Set(travellerIds).size !== travellerIds.length) throw invalid('Choose each traveller only once.');
  return {
    mode: input.mode,
    title,
    departurePlace,
    arrivalPlace,
    departureAt: departure.toISOString(),
    arrivalAt: arrival ? arrival.toISOString() : null,
    departureTerminal: (input.departureTerminal ?? '').trim(),
    arrivalTerminal: (input.arrivalTerminal ?? '').trim(),
    bookingReference: (input.bookingReference ?? '').trim(),
    notes: (input.notes ?? '').trim(),
    travellerIds,
  };
}

export class TravelRepository {
  constructor(private readonly core: TripRepository) {}

  private async priorWrite(client: SqlClient, actor: string, tripId: string, scope: 'travel', key: string | undefined, input: unknown): Promise<string | undefined> {
    if (!key) return undefined;
    const digest = hash(JSON.stringify(input));
    await client.query(`INSERT INTO goa_core_write_idempotency (actor_id,trip_id,scope,request_key,request_hash)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [actor, tripId, scope, key, digest]);
    const [row] = await client.query<{ request_hash: string; target_id: string | null }>(`SELECT request_hash,target_id FROM goa_core_write_idempotency
      WHERE actor_id=$1 AND trip_id=$2 AND scope=$3 AND request_key=$4 FOR UPDATE`, [actor, tripId, scope, key]);
    if (row!.request_hash !== digest) throw conflict('This retry key was used for different information.');
    return row!.target_id ?? undefined;
  }

  private async finishWrite(client: SqlClient, actor: string, tripId: string, scope: string, key: string | undefined, id: string): Promise<void> {
    if (key) await client.query(`UPDATE goa_core_write_idempotency SET target_id=$5 WHERE actor_id=$1 AND trip_id=$2 AND scope=$3 AND request_key=$4`, [actor, tripId, scope, key, id]);
  }

  private async assertTravellers(client: SqlClient, tripId: string, travellerIds: string[]): Promise<void> {
    if (!travellerIds.length) return;
    const rows = await client.query<{ id: string }>('SELECT id FROM goa_core_expense_participants WHERE trip_id=$1', [tripId]);
    const known = new Set(rows.map((row) => row.id.toLowerCase()));
    if (travellerIds.some((id) => !known.has(id))) throw invalid('Choose travellers from this trip.');
  }

  private async replaceTravellers(client: SqlClient, tripId: string, segmentId: string, travellerIds: string[]): Promise<void> {
    await client.query('DELETE FROM goa_core_travel_travellers WHERE trip_id=$1 AND segment_id=$2', [tripId, segmentId]);
    for (const participantId of travellerIds) {
      await client.query('INSERT INTO goa_core_travel_travellers (trip_id, segment_id, participant_id) VALUES ($1,$2,$3)', [tripId, segmentId, participantId]);
    }
  }

  private async withTravellers(client: SqlClient, tripId: string, rows: SegmentRow[]): Promise<TravelSegment[]> {
    if (!rows.length) return [];
    const links = await client.query<{ segmentId: string; participantId: string }>(
      `SELECT segment_id AS "segmentId", participant_id AS "participantId"
       FROM goa_core_travel_travellers WHERE trip_id=$1 ORDER BY participant_id`,
      [tripId],
    );
    const bySegment = new Map<string, string[]>();
    for (const link of links) {
      const list = bySegment.get(link.segmentId) ?? [];
      list.push(link.participantId);
      bySegment.set(link.segmentId, list);
    }
    return rows.map((row) => ({
      id: row.id,
      tripId: row.tripId,
      mode: row.mode,
      title: row.title,
      departurePlace: row.departurePlace,
      arrivalPlace: row.arrivalPlace,
      departureAt: instant(row.departureAt),
      arrivalAt: row.arrivalAt === null ? null : instant(row.arrivalAt),
      departureTerminal: row.departureTerminal,
      arrivalTerminal: row.arrivalTerminal,
      bookingReference: row.bookingReference,
      notes: row.notes,
      travellerIds: bySegment.get(row.id) ?? [],
      createdBy: row.createdBy,
      createdAt: instant(row.createdAt),
      updatedAt: instant(row.updatedAt),
    }));
  }

  private async segment(client: SqlClient, tripId: string, segmentId: string): Promise<TravelSegment> {
    const [row] = await client.query<SegmentRow>(`${segmentSelect} WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL`, [tripId, segmentId]);
    if (!row) throw notFound();
    const [mapped] = await this.withTravellers(client, tripId, [row]);
    return mapped!;
  }

  async list(actor: string, tripId: string): Promise<TravelSegment[]> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      const rows = await client.query<SegmentRow>(`${segmentSelect} WHERE trip_id=$1 AND deleted_at IS NULL ORDER BY departure_at, id`, [tripId]);
      return this.withTravellers(client, tripId, rows);
    });
  }

  async create(actor: string, tripId: string, input: TravelWrite, key?: string): Promise<TravelSegment> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      const normalized = normalizeTravel(input);
      await this.assertTravellers(client, tripId, normalized.travellerIds);
      const prior = await this.priorWrite(client, actor, tripId, 'travel', key, normalized);
      if (prior) return this.segment(client, tripId, prior);
      const id = randomUUID();
      await client.query(`INSERT INTO goa_core_travel_segments (
        id, trip_id, mode, title, departure_place, arrival_place, departure_at, arrival_at,
        departure_terminal, arrival_terminal, booking_reference, notes, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9,$10,$11,$12,$13)`, [
        id, tripId, normalized.mode, normalized.title, normalized.departurePlace, normalized.arrivalPlace,
        normalized.departureAt, normalized.arrivalAt, normalized.departureTerminal, normalized.arrivalTerminal,
        normalized.bookingReference, normalized.notes, actor,
      ]);
      await this.replaceTravellers(client, tripId, id, normalized.travellerIds);
      await this.finishWrite(client, actor, tripId, 'travel', key, id);
      await this.core.audit(client, actor, tripId, 'travel.created', id, null);
      return this.segment(client, tripId, id);
    });
  }

  async update(actor: string, tripId: string, segmentId: string, input: TravelWrite): Promise<TravelSegment> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      const normalized = normalizeTravel(input);
      await this.assertTravellers(client, tripId, normalized.travellerIds);
      await this.segment(client, tripId, segmentId);
      const updated = await client.query(`UPDATE goa_core_travel_segments SET mode=$3, title=$4, departure_place=$5, arrival_place=$6,
        departure_at=$7::timestamptz, arrival_at=$8::timestamptz, departure_terminal=$9, arrival_terminal=$10,
        booking_reference=$11, notes=$12, updated_at=now()
        WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id`, [
        tripId, segmentId, normalized.mode, normalized.title, normalized.departurePlace, normalized.arrivalPlace,
        normalized.departureAt, normalized.arrivalAt, normalized.departureTerminal, normalized.arrivalTerminal,
        normalized.bookingReference, normalized.notes,
      ]);
      if (!updated.length) throw notFound();
      await this.replaceTravellers(client, tripId, segmentId, normalized.travellerIds);
      await this.core.audit(client, actor, tripId, 'travel.updated', segmentId, null);
      return this.segment(client, tripId, segmentId);
    });
  }

  async remove(actor: string, tripId: string, segmentId: string): Promise<void> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      const rows = await client.query(`UPDATE goa_core_travel_segments SET deleted_at=now(), updated_at=now()
        WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id`, [tripId, segmentId]);
      if (!rows.length) throw notFound();
      await this.core.audit(client, actor, tripId, 'travel.deleted', segmentId, null);
    });
  }
}
