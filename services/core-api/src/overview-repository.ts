import type { SqlClient } from './database.js';
import { ApiError } from './errors.js';
import type { TripRepository } from './repository.js';
import type {
  ActivityStatusValue,
  Contact,
  ContactRole,
  OverviewActivity,
  Stay,
  TravelMode,
  TravelSegment,
  TripOverview,
} from './trip-planning-types.js';

type TodayRow = {
  id: string;
  tripId: string;
  title: string;
  day: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  status: string;
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
};

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

type ContactRow = Omit<Contact, 'createdAt' | 'updatedAt' | 'role'> & {
  role: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const segmentSelect = `SELECT id, trip_id AS "tripId", mode, title, departure_place AS "departurePlace",
  arrival_place AS "arrivalPlace", departure_at AS "departureAt", arrival_at AS "arrivalAt",
  departure_terminal AS "departureTerminal", arrival_terminal AS "arrivalTerminal",
  booking_reference AS "bookingReference", notes, created_by AS "createdBy",
  created_at AS "createdAt", updated_at AS "updatedAt"
  FROM goa_core_travel_segments`;

const stayColumns = `SELECT id, trip_id AS "tripId", property_name AS "propertyName", address, latitude, longitude,
  check_in AS "checkIn", check_out AS "checkOut", phone, contact_name AS "contactName", notes,
  created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt" FROM goa_core_stays`;

const contactSelect = `SELECT id, trip_id AS "tripId", role, name, phone, note, stay_id AS "stayId", activity_id AS "activityId",
  created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt" FROM goa_core_contacts`;

const kolkataToday = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;

function instant(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Unable to complete this request. Please try again.');
  return date.toISOString();
}

function asCoordinate(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function activityStatus(value: string): ActivityStatusValue {
  if (value === 'planned' || value === 'confirmed' || value === 'cancelled') return value;
  throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Unable to complete this request. Please try again.');
}

function contactRole(value: string): ContactRole {
  if (value === 'organiser' || value === 'hotel' || value === 'driver' || value === 'rental' || value === 'activity_provider') return value;
  throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'Unable to complete this request. Please try again.');
}

function mapStay(row: StayRow, guestIds: string[]): Stay {
  return {
    id: row.id,
    tripId: row.tripId,
    propertyName: row.propertyName,
    address: row.address,
    latitude: asCoordinate(row.latitude),
    longitude: asCoordinate(row.longitude),
    checkIn: instant(row.checkIn),
    checkOut: instant(row.checkOut),
    phone: row.phone,
    contactName: row.contactName,
    notes: row.notes,
    guestIds,
    createdBy: row.createdBy,
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
  };
}

function mapContact(row: ContactRow): Contact {
  return {
    id: row.id,
    tripId: row.tripId,
    role: contactRole(row.role),
    name: row.name,
    phone: row.phone,
    note: row.note,
    stayId: row.stayId,
    activityId: row.activityId,
    createdBy: row.createdBy,
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
  };
}

export class OverviewRepository {
  constructor(private readonly core: TripRepository) {}

  async get(actor: string, tripId: string): Promise<TripOverview> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      return {
        today: await this.today(client, tripId),
        upcomingTravel: await this.upcomingTravel(client, tripId),
        stays: await this.stays(client, tripId),
        contacts: await this.contacts(client, tripId),
      };
    });
  }

  private async today(client: SqlClient, tripId: string): Promise<OverviewActivity[]> {
    const rows = await client.query<TodayRow>(`
      SELECT a.id, a.trip_id AS "tripId", a.title, to_char(a.day, 'YYYY-MM-DD') AS day,
        a.start_time AS "startTime", a.end_time AS "endTime", a.location,
        COALESCE(activity_status.status, 'planned') AS status
      FROM goa_core_activities a
      LEFT JOIN goa_core_activity_status activity_status
        ON activity_status.activity_id = a.id AND activity_status.trip_id = a.trip_id
      WHERE a.trip_id = $1
        AND a.deleted_at IS NULL
        AND a.day = ${kolkataToday}
        AND COALESCE(activity_status.status, 'planned') IN ('planned', 'confirmed')
      ORDER BY a.start_time NULLS LAST, a.sort_order, a.id`, [tripId]);
    return rows.map((row) => ({
      id: row.id,
      tripId: row.tripId,
      title: row.title,
      day: row.day,
      startTime: row.startTime,
      endTime: row.endTime,
      location: row.location ?? '',
      status: activityStatus(row.status),
    }));
  }

  private async upcomingTravel(client: SqlClient, tripId: string): Promise<TravelSegment[]> {
    const rows = await client.query<SegmentRow>(`${segmentSelect}
      WHERE trip_id = $1 AND deleted_at IS NULL AND departure_at > now()
      ORDER BY departure_at ASC, id ASC
      LIMIT 5`, [tripId]);
    if (!rows.length) return [];
    const links = await client.query<{ segmentId: string; participantId: string }>(
      `SELECT segment_id AS "segmentId", participant_id AS "participantId"
       FROM goa_core_travel_travellers WHERE trip_id = $1 ORDER BY participant_id`,
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

  private async stays(client: SqlClient, tripId: string): Promise<Stay[]> {
    const rows = await client.query<StayRow>(`
      WITH kolkata_day AS (
        SELECT
          ((now() AT TIME ZONE 'Asia/Kolkata')::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS day_start,
          (((now() AT TIME ZONE 'Asia/Kolkata')::date + 1))::timestamp AT TIME ZONE 'Asia/Kolkata' AS day_end
      )
      ${stayColumns}
      CROSS JOIN kolkata_day
      WHERE trip_id = $1
        AND deleted_at IS NULL
        AND (
          (check_in < kolkata_day.day_end AND check_out >= kolkata_day.day_start)
          OR check_in > now()
        )
      ORDER BY
        CASE WHEN check_in < kolkata_day.day_end AND check_out >= kolkata_day.day_start THEN 0 ELSE 1 END,
        check_in ASC,
        id ASC
      LIMIT 5`, [tripId]);
    if (!rows.length) return [];
    const guests = await client.query<{ stayId: string; participantId: string }>(
      `SELECT stay_id::text AS "stayId", participant_id::text AS "participantId"
       FROM goa_core_stay_guests WHERE trip_id = $1 ORDER BY participant_id`,
      [tripId],
    );
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

  private async contacts(client: SqlClient, tripId: string): Promise<Contact[]> {
    const rows = await client.query<ContactRow>(`${contactSelect}
      WHERE trip_id = $1 AND deleted_at IS NULL
      ORDER BY role, name, id`, [tripId]);
    return rows.map(mapContact);
  }
}
