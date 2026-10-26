import { randomUUID } from 'node:crypto';
import { uuidPattern } from './auth.js';
import type { SqlClient } from './database.js';
import { ApiError, invalid, notFound } from './errors.js';
import { hash, TripRepository } from './repository.js';
import type { ReelIdea, ReelIdeaInput } from './reel-idea-types.js';
import type { Role } from './types.js';

type IdeaRow = Omit<ReelIdea, 'createdAt' | 'updatedAt'> & { createdAt: Date | string; updatedAt: Date | string };
const ideaSelect = `SELECT i.id, i.trip_id AS "tripId", i.title, i.kind, i.instagram_url AS "instagramUrl", i.location, i.notes,
  i.version, i.created_by AS "createdBy", i.created_at AS "createdAt", i.updated_at AS "updatedAt",
  ARRAY(SELECT p.user_id::text FROM goa_core_reel_idea_people p WHERE p.trip_id=i.trip_id AND p.idea_id=i.id ORDER BY p.user_id) AS "participantUserIds"
  FROM goa_core_reel_ideas i`;
const mapIdea = (row: IdeaRow): ReelIdea => ({ ...row, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() });
const conflict = (message: string) => new ApiError(409, 'CONFLICT', message);

function normalize(input: ReelIdeaInput): ReelIdeaInput {
  const title = input.title.trim();
  if (!title) throw invalid('Give the idea a title.');
  let instagramUrl: string | null = input.instagramUrl?.trim() || null;
  if (instagramUrl !== null) {
    try {
      const url = new URL(instagramUrl);
      if (!/^https:\/\//i.test(instagramUrl) || /[\u0000-\u0020\u007f\\]/.test(instagramUrl) || url.protocol !== 'https:' ||
        !(url.hostname === 'instagram.com' || url.hostname.endsWith('.instagram.com')) || url.username || url.password || url.port) throw new Error();
      instagramUrl = url.toString();
      if (instagramUrl.length > 2048) throw new Error();
    } catch { throw invalid('Use an HTTPS Instagram link, or leave the link empty.'); }
  }
  const participantUserIds = [...new Set(input.participantUserIds.map((id) => id.toLowerCase()))].sort();
  if (!participantUserIds.length || participantUserIds.some((id) => !uuidPattern.test(id))) throw invalid('Choose at least one accepted trip member.');
  return { title, kind: input.kind, instagramUrl, location: input.location.trim(), notes: input.notes.trim(), participantUserIds };
}

export class ReelIdeaRepository {
  constructor(private readonly core: TripRepository) {}

  private async idea(client: SqlClient, tripId: string, ideaId: string): Promise<ReelIdea> {
    const [row] = await client.query<IdeaRow>(`${ideaSelect} WHERE i.trip_id=$1 AND i.id=$2 AND i.deleted_at IS NULL FOR UPDATE OF i`, [tripId, ideaId]);
    if (!row) throw notFound();
    return mapIdea(row);
  }

  private assertEditor(idea: Pick<ReelIdea, 'createdBy'>, actor: string, role: Role): void {
    if (idea.createdBy !== actor && role !== 'organiser') throw new ApiError(403, 'FORBIDDEN', 'Only the creator or organiser can change this idea.');
  }

  private async assertPeople(client: SqlClient, tripId: string, people: string[]): Promise<void> {
    const rows = await client.query<{ user_id: string }>(`SELECT user_id FROM goa_core_memberships
      WHERE trip_id=$1 AND user_id=ANY($2::uuid[]) AND status='accepted' ORDER BY user_id FOR UPDATE`, [tripId, people]);
    if (rows.length !== people.length) throw invalid('Choose accepted members of this trip.');
  }

  private async writePeople(client: SqlClient, tripId: string, ideaId: string, people: string[]): Promise<void> {
    await client.query('DELETE FROM goa_core_reel_idea_people WHERE trip_id=$1 AND idea_id=$2', [tripId, ideaId]);
    for (const userId of people) await client.query('INSERT INTO goa_core_reel_idea_people (trip_id,idea_id,user_id) VALUES ($1,$2,$3)', [tripId, ideaId, userId]);
  }

  async list(actor: string, tripId: string): Promise<ReelIdea[]> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      return (await client.query<IdeaRow>(`${ideaSelect} WHERE i.trip_id=$1 AND i.deleted_at IS NULL ORDER BY i.created_at DESC,i.id`, [tripId])).map(mapIdea);
    });
  }

  async create(actor: string, tripId: string, input: ReelIdeaInput, key?: string): Promise<ReelIdea> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      const normalized = normalize(input);
      if (key) {
        const digest = hash(JSON.stringify(normalized));
        await client.query(`INSERT INTO goa_core_write_idempotency (actor_id,trip_id,scope,request_key,request_hash)
          VALUES ($1,$2,'reel-idea',$3,$4) ON CONFLICT DO NOTHING`, [actor, tripId, key, digest]);
        const [prior] = await client.query<{ request_hash: string; target_id: string | null }>(`SELECT request_hash,target_id FROM goa_core_write_idempotency
          WHERE actor_id=$1 AND trip_id=$2 AND scope='reel-idea' AND request_key=$3 FOR UPDATE`, [actor, tripId, key]);
        if (prior!.request_hash !== digest) throw conflict('This retry key was used for different information.');
        if (prior!.target_id) return this.idea(client, tripId, prior!.target_id);
      }
      await this.assertPeople(client, tripId, normalized.participantUserIds);
      const id = randomUUID();
      await client.query(`INSERT INTO goa_core_reel_ideas (id,trip_id,title,kind,instagram_url,location,notes,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, tripId, normalized.title, normalized.kind, normalized.instagramUrl, normalized.location, normalized.notes, actor]);
      await this.writePeople(client, tripId, id, normalized.participantUserIds);
      if (key) await client.query(`UPDATE goa_core_write_idempotency SET target_id=$4
        WHERE actor_id=$1 AND trip_id=$2 AND scope='reel-idea' AND request_key=$3`, [actor, tripId, key, id]);
      await this.core.audit(client, actor, tripId, 'reel-idea.created', id);
      return this.idea(client, tripId, id);
    });
  }

  async update(actor: string, tripId: string, ideaId: string, input: ReelIdeaInput & { version: number }): Promise<ReelIdea> {
    return this.core.database.transaction(async (client) => {
      const role = await this.core.membership(client, actor, tripId);
      const current = await this.idea(client, tripId, ideaId);
      this.assertEditor(current, actor, role);
      if (current.version !== input.version) throw conflict('This idea changed. Reload it before saving your changes.');
      const normalized = normalize(input);
      await this.assertPeople(client, tripId, normalized.participantUserIds);
      const rows = await client.query(`UPDATE goa_core_reel_ideas SET title=$3,kind=$4,instagram_url=$5,location=$6,notes=$7,
        version=version+1,updated_at=now() WHERE trip_id=$1 AND id=$2 AND version=$8 AND deleted_at IS NULL RETURNING id`,
      [tripId, ideaId, normalized.title, normalized.kind, normalized.instagramUrl, normalized.location, normalized.notes, input.version]);
      if (!rows.length) throw conflict('This idea changed. Reload it before saving your changes.');
      await this.writePeople(client, tripId, ideaId, normalized.participantUserIds);
      await this.core.audit(client, actor, tripId, 'reel-idea.updated', ideaId);
      return this.idea(client, tripId, ideaId);
    });
  }

  async delete(actor: string, tripId: string, ideaId: string): Promise<void> {
    return this.core.database.transaction(async (client) => {
      const role = await this.core.membership(client, actor, tripId);
      const [current] = await client.query<{ createdBy: string; deletedAt: Date | string | null }>(
        `SELECT created_by AS "createdBy",deleted_at AS "deletedAt" FROM goa_core_reel_ideas WHERE trip_id=$1 AND id=$2 FOR UPDATE`, [tripId, ideaId]);
      if (!current) throw notFound();
      this.assertEditor(current, actor, role);
      // A lost response can be retried safely by an authorised editor without
      // creating a second audit row or exposing a deleted row to other members.
      if (current.deletedAt !== null) return;
      await client.query('UPDATE goa_core_reel_ideas SET deleted_at=now(),updated_at=now() WHERE trip_id=$1 AND id=$2', [tripId, ideaId]);
      await this.core.audit(client, actor, tripId, 'reel-idea.deleted', ideaId);
    });
  }
}
