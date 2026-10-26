import { randomUUID } from 'node:crypto';
import type { SqlClient } from './database.js';
import { removeVotesForPlace } from './vote-repository.js';
import { LedgerRepository } from './ledger-repository.js';
import { ApiError, invalid, notFound } from './errors.js';
import { exactTotal, perPerson, plannedCategory } from './money.js';
import { hash, mapTrip, tripSelect, TripRepository, type TripRow } from './repository.js';
import type { Activity, ActivityInput, Budget, CreateTrip, SavedPlace, SavedPlaceInput, Trip } from './types.js';
import { expenseCategories, isCalendarDate, validateActivity, validateSavedPlace, validateTrip } from './validation.js';

type ActivityRow = Omit<Activity, 'estimatedCostPaise'> & { estimatedCostPaise: string | number; deletedAt: Date | null };
type PlaceRow = Omit<SavedPlace, 'createdAt'> & { createdAt: Date | string };
const activitySelect = `SELECT id,trip_id AS "tripId",title,description,location,category,day::text,
  start_time AS "startTime",end_time AS "endTime",estimated_cost_paise AS "estimatedCostPaise",notes,
  meeting_point AS "meetingPoint",place_id AS "placeId",latitude,longitude,sort_order AS "sortOrder",version,
  created_by AS "createdBy",deleted_at AS "deletedAt" FROM goa_core_activities`;
const placeSelect = `SELECT place_id AS "placeId",title,category,region,latitude,longitude,source_url AS "sourceUrl",
  saved_by AS "savedBy",created_at AS "createdAt" FROM goa_core_saved_places`;
const mapActivity = ({ deletedAt: _deleted, ...row }: ActivityRow): Activity => ({ ...row, estimatedCostPaise: Number(row.estimatedCostPaise) });
const mapPlace = (row: PlaceRow): SavedPlace => ({ ...row, createdAt: new Date(row.createdAt).toISOString() });
const conflict = (message: string) => new ApiError(409, 'CONFLICT', message);
const defaultActivity = (input: Partial<ActivityInput> & { title: string }): ActivityInput => ({
  title: input.title.trim(), description: input.description ?? '', location: input.location ?? '', category: input.category ?? 'other',
  day: input.day ?? null, startTime: input.startTime ?? null, endTime: input.endTime ?? null, estimatedCostPaise: input.estimatedCostPaise ?? 0,
  notes: input.notes ?? '', meetingPoint: input.meetingPoint ?? '', placeId: input.placeId ?? null, latitude: input.latitude ?? null, longitude: input.longitude ?? null,
});
const activityValues = (a: ActivityInput): unknown[] => [a.title.trim(),a.description,a.location,a.category,a.day,a.startTime,a.endTime,a.estimatedCostPaise,a.notes,a.meetingPoint,a.placeId,a.latitude,a.longitude];

export class PlanningRepository {
  constructor(private readonly core: TripRepository) {}

  private async trip(client: SqlClient, actor: string, tripId: string): Promise<Trip> {
    const [row] = await client.query<TripRow>(`${tripSelect} WHERE t.id=$1 AND m.user_id=$2 AND t.deleted_at IS NULL`, [tripId,actor]);
    if (!row) throw notFound();
    return mapTrip(row);
  }

  async updateTrip(actor: string, tripId: string, patch: Partial<CreateTrip>): Promise<Trip> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client,actor,tripId,true);
      const current = await this.trip(client,actor,tripId);
      const next = { ...current,...patch };
      validateTrip(next);
      const outside = await client.query(`SELECT id FROM goa_core_activities WHERE trip_id=$1 AND deleted_at IS NULL
        AND day IS NOT NULL AND (day < $2 OR day > $3) LIMIT 1`, [tripId,next.startDate,next.endDate]);
      if (outside.length) throw conflict('Existing activities fall outside those dates. Move them before changing trip dates.');
      await client.query(`UPDATE goa_core_trips SET name=$2,start_date=$3,end_date=$4,description=$5,region=$6,
        traveller_count=$7,budget_paise=$8,styles=$9 WHERE id=$1`, [tripId,next.name.trim(),next.startDate,next.endDate,next.description.trim(),
        next.region,next.travellerCount,next.budgetPaise,next.styles]);
      await this.core.audit(client,actor,tripId,'trip.updated',tripId);
      return this.trip(client,actor,tripId);
    });
  }

  async deleteTrip(actor: string, tripId: string): Promise<void> {
    return this.core.database.transaction(async (client) => {
      const role = await this.core.membership(client,actor,tripId,false,true);
      if (role !== 'organiser') {
        const [trip] = await client.query<{ deleted_at: Date | null }>('SELECT deleted_at FROM goa_core_trips WHERE id=$1',[tripId]);
        if (trip!.deleted_at) throw notFound();
        throw new ApiError(403,'FORBIDDEN','Only the organiser can do that.');
      }
      const rows = await client.query('UPDATE goa_core_trips SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id', [tripId]);
      if (rows.length) await this.core.audit(client,actor,tripId,'trip.deleted',tripId);
    });
  }

  private async priorWrite(client: SqlClient, actor: string, tripId: string, scope: 'activity' | 'expense', key: string | undefined, input: unknown): Promise<string | undefined> {
    if (!key) return undefined;
    const digest = hash(JSON.stringify(input));
    await client.query(`INSERT INTO goa_core_write_idempotency (actor_id,trip_id,scope,request_key,request_hash)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [actor,tripId,scope,key,digest]);
    const [row] = await client.query<{ request_hash: string; target_id: string | null }>(`SELECT request_hash,target_id FROM goa_core_write_idempotency
      WHERE actor_id=$1 AND trip_id=$2 AND scope=$3 AND request_key=$4 FOR UPDATE`, [actor,tripId,scope,key]);
    if (row!.request_hash !== digest) throw conflict('This retry key was used for different information.');
    return row!.target_id ?? undefined;
  }
  private async finishWrite(client: SqlClient, actor: string, tripId: string, scope: string, key: string | undefined, id: string): Promise<void> {
    if (key) await client.query(`UPDATE goa_core_write_idempotency SET target_id=$5 WHERE actor_id=$1 AND trip_id=$2 AND scope=$3 AND request_key=$4`, [actor,tripId,scope,key,id]);
  }
  private async nextOrder(client: SqlClient, tripId: string, day: string | null): Promise<number> {
    const [row] = await client.query<{ next: number }>(`SELECT COALESCE(max(sort_order)+1,0)::integer AS next FROM goa_core_activities
      WHERE trip_id=$1 AND day IS NOT DISTINCT FROM $2::date AND deleted_at IS NULL`, [tripId,day]);
    return row!.next;
  }
  private async activity(client: SqlClient, tripId: string, activityId: string, includeDeleted = false): Promise<ActivityRow> {
    const [row] = await client.query<ActivityRow>(`${activitySelect} WHERE trip_id=$1 AND id=$2 AND ($3 OR deleted_at IS NULL)`, [tripId,activityId,includeDeleted]);
    if (!row) throw notFound();
    return row;
  }
  private async activities(client: SqlClient, tripId: string): Promise<Activity[]> {
    return (await client.query<ActivityRow>(`${activitySelect} WHERE trip_id=$1 AND deleted_at IS NULL ORDER BY day NULLS LAST,sort_order,created_at,id`, [tripId])).map(mapActivity);
  }

  async listActivities(actor: string, tripId: string): Promise<Activity[]> {
    return this.core.database.transaction(async (client) => { await this.core.membership(client,actor,tripId); return this.activities(client,tripId); });
  }
  async createActivity(actor: string, tripId: string, input: Partial<ActivityInput> & { title: string }, key?: string): Promise<Activity> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client,actor,tripId);
      const normalized = defaultActivity(input);
      validateActivity(normalized,await this.trip(client,actor,tripId));
      const prior = await this.priorWrite(client,actor,tripId,'activity',key,normalized);
      if (prior) return mapActivity(await this.activity(client,tripId,prior));
      const id = randomUUID();
      const order = await this.nextOrder(client,tripId,normalized.day);
      await client.query(`INSERT INTO goa_core_activities (id,trip_id,title,description,location,category,day,start_time,end_time,
        estimated_cost_paise,notes,meeting_point,place_id,latitude,longitude,sort_order,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [id,tripId,...activityValues(normalized),order,actor]);
      await this.finishWrite(client,actor,tripId,'activity',key,id);
      await this.core.audit(client,actor,tripId,'activity.created',id);
      return mapActivity(await this.activity(client,tripId,id));
    });
  }
  async updateActivity(actor: string, tripId: string, activityId: string, patch: Partial<ActivityInput> & { version: number }): Promise<Activity> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client,actor,tripId);
      const current = mapActivity(await this.activity(client,tripId,activityId));
      if (current.version !== patch.version) throw conflict('This activity changed. Reload it before saving.');
      const next = { ...current,...patch };
      validateActivity(next,await this.trip(client,actor,tripId));
      const order = next.day === current.day ? current.sortOrder : await this.nextOrder(client,tripId,next.day);
      await client.query(`UPDATE goa_core_activities SET title=$3,description=$4,location=$5,category=$6,day=$7,start_time=$8,end_time=$9,
        estimated_cost_paise=$10,notes=$11,meeting_point=$12,place_id=$13,latitude=$14,longitude=$15,sort_order=$16,
        version=version+1,updated_at=now() WHERE trip_id=$1 AND id=$2`, [tripId,activityId,...activityValues(next),order]);
      await this.core.audit(client,actor,tripId,'activity.updated',activityId);
      return mapActivity(await this.activity(client,tripId,activityId));
    });
  }
  async deleteActivity(actor: string, tripId: string, activityId: string): Promise<void> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client,actor,tripId);
      const row = await this.activity(client,tripId,activityId,true);
      if (row.deletedAt) return;
      await client.query('UPDATE goa_core_activities SET deleted_at=now(),version=version+1,updated_at=now() WHERE id=$1', [activityId]);
      await this.core.audit(client,actor,tripId,'activity.deleted',activityId);
    });
  }
  async reorder(actor: string, tripId: string, day: string | null, ids: string[]): Promise<Activity[]> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client,actor,tripId);
      const trip = await this.trip(client,actor,tripId);
      if (day !== null && (!isCalendarDate(day) || day < trip.startDate || day > trip.endDate)) throw invalid('Use a day within this trip.');
      const rows = await client.query<{ id: string }>('SELECT id FROM goa_core_activities WHERE trip_id=$1 AND day IS NOT DISTINCT FROM $2::date AND deleted_at IS NULL FOR UPDATE', [tripId,day]);
      const expected = new Set(rows.map((row) => row.id));
      if (ids.length !== expected.size || new Set(ids).size !== ids.length || ids.some((id) => !expected.has(id))) {
        throw conflict('The activities for this day changed. Reload before reordering.');
      }
      for (const [index,id] of ids.entries()) await client.query('UPDATE goa_core_activities SET sort_order=$2,version=version+1,updated_at=now() WHERE id=$1', [id,index]);
      if (ids.length) await this.core.audit(client,actor,tripId,'activity.reordered',tripId);
      return (await this.activities(client,tripId)).filter((activity) => activity.day === day);
    });
  }

  async listPlaces(actor: string, tripId: string): Promise<SavedPlace[]> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client,actor,tripId);
      return (await client.query<PlaceRow>(`${placeSelect} WHERE trip_id=$1 ORDER BY created_at,place_id`, [tripId])).map(mapPlace);
    });
  }
  async savePlace(actor: string, tripId: string, input: SavedPlaceInput): Promise<SavedPlace> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client,actor,tripId);
      validateSavedPlace(input);
      const inserted = await client.query(`INSERT INTO goa_core_saved_places (trip_id,place_id,title,category,region,latitude,longitude,source_url,saved_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (trip_id,place_id) DO NOTHING RETURNING place_id`,
        [tripId,input.placeId,input.title.trim(),input.category,input.region,input.latitude,input.longitude,input.sourceUrl,actor]);
      if (inserted.length) await this.core.audit(client,actor,tripId,'place.saved',tripId,input.placeId);
      const [row] = await client.query<PlaceRow>(`${placeSelect} WHERE trip_id=$1 AND place_id=$2`, [tripId,input.placeId]);
      return mapPlace(row!);
    });
  }
  async unsavePlace(actor: string, tripId: string, placeId: string): Promise<void> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client,actor,tripId);
      await removeVotesForPlace(client,tripId,placeId); // votes: delete place votes with the save
      const rows = await client.query('DELETE FROM goa_core_saved_places WHERE trip_id=$1 AND place_id=$2 RETURNING place_id', [tripId,placeId]);
      if (rows.length) await this.core.audit(client,actor,tripId,'place.unsaved',tripId,placeId);
    });
  }

  async budget(actor: string, tripId: string): Promise<Budget> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client,actor,tripId);
      const trip = await this.trip(client,actor,tripId);
      const activities = await this.activities(client,tripId);
      const expenses = await new LedgerRepository(this.core).expenses(client,tripId);
      const plannedTotalPaise = exactTotal(activities.map((activity) => activity.estimatedCostPaise));
      const actualTotalPaise = exactTotal(expenses.map((expense) => expense.amountPaise));
      const limitRows = await client.query<{ category: string; limitPaise: string | number }>(
        'SELECT category, limit_paise AS "limitPaise" FROM goa_core_budget_category_limits WHERE trip_id=$1', [tripId]);
      const limitByCategory = new Map(limitRows.map((row) => [row.category, Number(row.limitPaise)]));
      return { budgetPaise: trip.budgetPaise, plannedTotalPaise, actualTotalPaise,
        remainingPaise: trip.budgetPaise === null ? null : trip.budgetPaise - actualTotalPaise,
        forecastRemainingPaise: trip.budgetPaise === null ? null : trip.budgetPaise - plannedTotalPaise,
        estimatedPerPersonPaise: perPerson(plannedTotalPaise,trip.travellerCount), actualPerPersonPaise: perPerson(actualTotalPaise,trip.travellerCount),
        categoryTotals: expenseCategories.map((category) => ({ category,
          plannedPaise: exactTotal(activities.filter((activity) => plannedCategory(activity.category) === category).map((activity) => activity.estimatedCostPaise)),
          actualPaise: exactTotal(expenses.filter((expense) => expense.category === category).map((expense) => expense.amountPaise)),
          limitPaise: limitByCategory.get(category) ?? null })), expenses };
    });
  }
}
