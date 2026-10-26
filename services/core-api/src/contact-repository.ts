import { randomUUID } from 'node:crypto';
import type { SqlClient } from './database.js';
import { ApiError, invalid, notFound } from './errors.js';
import { hash, TripRepository } from './repository.js';
import type { Contact, ContactInput, ContactRole } from './trip-planning-types.js';

export type ContactWrite = {
  role: ContactRole;
  name: string;
  phone?: string;
  note?: string;
  stayId?: string | null;
  activityId?: string | null;
};

type ContactRow = Omit<Contact, 'createdAt' | 'updatedAt'> & { createdAt: Date | string; updatedAt: Date | string };
const contactSelect = `SELECT id, trip_id AS "tripId", role, name, phone, note, stay_id AS "stayId", activity_id AS "activityId",
  created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt" FROM goa_core_contacts`;
const mapContact = (row: ContactRow): Contact => ({
  id: row.id, tripId: row.tripId, role: row.role, name: row.name, phone: row.phone, note: row.note,
  stayId: row.stayId, activityId: row.activityId, createdBy: row.createdBy,
  createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
});
const conflict = (message: string) => new ApiError(409, 'CONFLICT', message);

function normalize(input: ContactWrite): ContactInput {
  const name = input.name.trim();
  if (!name) throw invalid('Give the contact a name.');
  return {
    role: input.role, name, phone: input.phone ?? '', note: input.note ?? '',
    stayId: input.stayId ?? null, activityId: input.activityId ?? null,
  };
}

export class ContactRepository {
  constructor(private readonly core: TripRepository) {}

  private async priorWrite(client: SqlClient, actor: string, tripId: string, key: string | undefined, input: ContactInput): Promise<string | undefined> {
    if (!key) return undefined;
    const digest = hash(JSON.stringify(input));
    await client.query(`INSERT INTO goa_core_write_idempotency (actor_id,trip_id,scope,request_key,request_hash)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [actor, tripId, 'contact', key, digest]);
    const [row] = await client.query<{ request_hash: string; target_id: string | null }>(`SELECT request_hash,target_id FROM goa_core_write_idempotency
      WHERE actor_id=$1 AND trip_id=$2 AND scope=$3 AND request_key=$4 FOR UPDATE`, [actor, tripId, 'contact', key]);
    if (row!.request_hash !== digest) throw conflict('This retry key was used for different information.');
    return row!.target_id ?? undefined;
  }

  private async finishWrite(client: SqlClient, actor: string, tripId: string, key: string | undefined, id: string): Promise<void> {
    if (key) await client.query(`UPDATE goa_core_write_idempotency SET target_id=$5 WHERE actor_id=$1 AND trip_id=$2 AND scope=$3 AND request_key=$4`, [actor, tripId, 'contact', key, id]);
  }

  private async contact(client: SqlClient, tripId: string, contactId: string): Promise<ContactRow> {
    const [row] = await client.query<ContactRow>(`${contactSelect} WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`, [tripId, contactId]);
    if (!row) throw notFound();
    return row;
  }

  private async assertLinked(client: SqlClient, tripId: string, input: ContactInput): Promise<void> {
    if (input.stayId) {
      const stay = await client.query(`SELECT id FROM goa_core_stays WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`, [tripId, input.stayId]);
      if (!stay.length) throw invalid('Choose a stay on this trip.');
    }
    if (input.activityId) {
      const activity = await client.query(`SELECT id FROM goa_core_activities WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`, [tripId, input.activityId]);
      if (!activity.length) throw invalid('Choose an activity on this trip.');
    }
  }

  async listContacts(actor: string, tripId: string): Promise<Contact[]> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      return (await client.query<ContactRow>(`${contactSelect} WHERE trip_id=$1 AND deleted_at IS NULL ORDER BY role, name, id`, [tripId])).map(mapContact);
    });
  }

  async createContact(actor: string, tripId: string, input: ContactWrite, key?: string): Promise<Contact> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      const normalized = normalize(input);
      const prior = await this.priorWrite(client, actor, tripId, key, normalized);
      if (prior) return mapContact(await this.contact(client, tripId, prior));
      await this.assertLinked(client, tripId, normalized);
      const id = randomUUID();
      await client.query(`INSERT INTO goa_core_contacts (id,trip_id,role,name,phone,note,stay_id,activity_id,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, tripId, normalized.role, normalized.name, normalized.phone, normalized.note, normalized.stayId, normalized.activityId, actor]);
      await this.finishWrite(client, actor, tripId, key, id);
      await this.core.audit(client, actor, tripId, 'contact.created', id);
      return mapContact(await this.contact(client, tripId, id));
    });
  }

  async updateContact(actor: string, tripId: string, contactId: string, input: ContactWrite): Promise<Contact> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      await this.contact(client, tripId, contactId);
      const normalized = normalize(input);
      await this.assertLinked(client, tripId, normalized);
      const updated = await client.query(`UPDATE goa_core_contacts SET role=$3,name=$4,phone=$5,note=$6,stay_id=$7,activity_id=$8,updated_at=now()
        WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id`, [tripId, contactId, normalized.role, normalized.name, normalized.phone, normalized.note, normalized.stayId, normalized.activityId]);
      if (!updated.length) throw notFound();
      await this.core.audit(client, actor, tripId, 'contact.updated', contactId);
      return mapContact(await this.contact(client, tripId, contactId));
    });
  }

  async deleteContact(actor: string, tripId: string, contactId: string): Promise<void> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      const removed = await client.query(`UPDATE goa_core_contacts SET deleted_at=now(),updated_at=now()
        WHERE trip_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING id`, [tripId, contactId]);
      if (!removed.length) throw notFound();
      await this.core.audit(client, actor, tripId, 'contact.deleted', contactId);
    });
  }
}
