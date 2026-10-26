import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Database, SqlClient } from './database.js';
import { ApiError, forbidden, notFound } from './errors.js';
import type { CreateTrip, Identity, Invitation, Member, Role, Status, Trip, User, Region, TripStyle } from './types.js';

export type TripRow = { id: string; name: string; start_date: string; end_date: string; description: string; created_at: Date | string; role: Role;
  region: Region; traveller_count: number; budget_paise: string | number | null; styles: TripStyle[]; accepted_member_count: number; activity_count: number };
type MemberRow = { user_id: string; display_name: string; role: Role; status: Status };
type InvitationRow = { id: string; trip_id: string; expires_at: Date | string; revoked_at: Date | string | null; requires_approval: boolean; created_at: Date | string };
const iso = (value: Date | string) => new Date(value).toISOString();
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const tripSelect = `SELECT t.id, t.name, t.start_date::text, t.end_date::text, t.description, t.created_at, m.role,
  t.region,t.traveller_count,t.budget_paise,t.styles,
  (SELECT count(*)::integer FROM goa_core_memberships people WHERE people.trip_id=t.id AND people.status='accepted') AS accepted_member_count,
  (SELECT count(*)::integer FROM goa_core_activities a WHERE a.trip_id=t.id AND a.deleted_at IS NULL) AS activity_count
  FROM goa_core_trips t JOIN goa_core_memberships m ON m.trip_id = t.id`;
export const mapTrip = (row: TripRow): Trip => ({ id: row.id, name: row.name, startDate: row.start_date, endDate: row.end_date,
  description: row.description, createdAt: iso(row.created_at), role: row.role, region: row.region,
  travellerCount: row.traveller_count, budgetPaise: row.budget_paise === null ? null : Number(row.budget_paise),
  styles: row.styles, acceptedMemberCount: row.accepted_member_count, activityCount: row.activity_count });
const mapMember = (row: MemberRow): Member => ({ userId: row.user_id, displayName: row.display_name, role: row.role, status: row.status });
const mapInvitation = (row: InvitationRow): Invitation => ({ id: row.id, expiresAt: iso(row.expires_at),
  revoked: row.revoked_at !== null, requiresApproval: row.requires_approval, createdAt: iso(row.created_at) });

export class TripRepository {
  constructor(readonly database: Database) {}

  async resolveProfile(identity: Identity): Promise<User> {
    const [row] = await this.database.query<{ id: string; display_name: string; email: string | null }>(`
      INSERT INTO goa_core_profiles (id, display_name, email) VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET display_name = COALESCE($4, goa_core_profiles.display_name),
        email = COALESCE($5, goa_core_profiles.email), updated_at = now()
      RETURNING id, display_name, email`,
    [identity.id, identity.displayName || 'Traveller', identity.email || null, identity.displayName || null, identity.email || null]);
    return { id: row!.id, displayName: row!.display_name, email: row!.email };
  }

  async membership(client: SqlClient, actor: string, tripId: string, organiser = false, includeDeleted = false): Promise<Role> {
    // All trip mutations lock the trip before member/child rows, avoiding lock
    // inversions between removal, invitation acceptance, and planner writes.
    const trip = await client.query('SELECT id FROM goa_core_trips WHERE id=$1 AND ($2 OR deleted_at IS NULL) FOR UPDATE', [tripId, includeDeleted]);
    if (!trip.length) throw notFound();
    const [row] = await client.query<{ role: Role; status: Status }>(
      'SELECT role,status FROM goa_core_memberships WHERE trip_id=$1 AND user_id=$2 FOR UPDATE', [tripId, actor]);
    if (!row || row.status !== 'accepted') throw notFound();
    if (organiser && row.role !== 'organiser') throw forbidden();
    return row.role;
  }

  async audit(client: SqlClient, actor: string, tripId: string, action: string, target: string, targetKey: string | null = null): Promise<void> {
    await client.query('INSERT INTO goa_core_audit (id, actor_id, trip_id, action, target_id, target_key) VALUES ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), actor, tripId, action, target, targetKey]);
  }

  async rateLimit(scope: string, key: string, limit: number): Promise<void> {
    // Stored counters also apply across Lambda instances. Hash IP/account keys;
    // never retain a raw token or a client-supplied proxy header.
    const [row] = await this.database.query<{ hits: number }>(`
      INSERT INTO goa_core_rate_limits (scope, key_hash, bucket, hits)
      VALUES ($1, $2, date_trunc('minute', now()), 1)
      ON CONFLICT (scope, key_hash, bucket) DO UPDATE SET hits = goa_core_rate_limits.hits + 1
      RETURNING hits`, [scope, hash(key)]);
    if (row!.hits > limit) throw new ApiError(429, 'RATE_LIMITED', 'Please wait a minute before trying again.');
  }

  async pruneRateLimits(): Promise<void> {
    await this.database.query("DELETE FROM goa_core_rate_limits WHERE bucket < now() - interval '1 day'");
  }

  async listTrips(actor: string): Promise<Trip[]> {
    return (await this.database.query<TripRow>(`${tripSelect} WHERE m.user_id = $1 AND m.status = 'accepted' AND t.deleted_at IS NULL ORDER BY t.created_at DESC, t.id`, [actor])).map(mapTrip);
  }

  async createTrip(actor: string, input: CreateTrip, idempotencyKey?: string): Promise<Trip> {
    return this.database.transaction(async (client) => {
      const normalized = { name: input.name.trim(), startDate: input.startDate, endDate: input.endDate, description: input.description?.trim() || '',
        region: input.region ?? 'all', travellerCount: input.travellerCount ?? 1, budgetPaise: input.budgetPaise ?? null, styles: [...(input.styles ?? [])].sort() };
      const requestHash = hash(JSON.stringify(normalized));
      if (idempotencyKey) {
        await client.query(`INSERT INTO goa_core_trip_idempotency (actor_id, request_key, request_hash)
          VALUES ($1,$2,$3) ON CONFLICT (actor_id, request_key) DO NOTHING`, [actor, idempotencyKey, requestHash]);
        const [prior] = await client.query<{ request_hash: string; trip_id: string | null }>(`
          SELECT request_hash, trip_id FROM goa_core_trip_idempotency WHERE actor_id = $1 AND request_key = $2 FOR UPDATE`, [actor, idempotencyKey]);
        if (prior!.request_hash !== requestHash) throw new ApiError(409, 'CONFLICT', 'This retry key was used for a different trip.');
        if (prior!.trip_id) {
          const [trip] = await client.query<TripRow>(`${tripSelect} WHERE t.id = $1 AND m.user_id = $2 AND t.deleted_at IS NULL`, [prior!.trip_id, actor]);
          if (!trip) throw notFound();
          return mapTrip(trip!);
        }
      }
      const id = randomUUID();
      await client.query(`INSERT INTO goa_core_trips (id,name,start_date,end_date,description,created_by,region,traveller_count,budget_paise,styles)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id, normalized.name, normalized.startDate, normalized.endDate, normalized.description, actor,
          normalized.region,normalized.travellerCount,normalized.budgetPaise,normalized.styles]);
      await client.query(`INSERT INTO goa_core_memberships (trip_id,user_id,role,status,joined_at)
        VALUES ($1,$2,'organiser','accepted',now())`, [id, actor]);
      await this.audit(client, actor, id, 'trip.created', id);
      if (idempotencyKey) await client.query('UPDATE goa_core_trip_idempotency SET trip_id = $3 WHERE actor_id = $1 AND request_key = $2', [actor, idempotencyKey, id]);
      const [trip] = await client.query<TripRow>(`${tripSelect} WHERE t.id = $1 AND m.user_id = $2`, [id, actor]);
      return mapTrip(trip!);
    });
  }

  async getTrip(actor: string, tripId: string): Promise<{ trip: Trip; members: Member[]; invitations: Invitation[] }> {
    return this.database.transaction(async (client) => {
      const role = await this.membership(client, actor, tripId);
      const [trip] = await client.query<TripRow>(`${tripSelect} WHERE t.id = $1 AND m.user_id = $2`, [tripId, actor]);
      const members = await client.query<MemberRow>(`SELECT m.user_id,p.display_name,m.role,m.status
        FROM goa_core_memberships m JOIN goa_core_profiles p ON p.id = m.user_id
        WHERE m.trip_id = $1 AND (m.status = 'accepted' OR $2 = 'organiser') ORDER BY m.created_at, m.user_id`, [tripId, role]);
      const invitations = role === 'organiser'
        ? (await client.query<InvitationRow>('SELECT * FROM goa_core_invitations WHERE trip_id = $1 ORDER BY created_at DESC, id', [tripId])).map(mapInvitation) : [];
      return { trip: mapTrip(trip!), members: members.map(mapMember), invitations };
    });
  }

  async createInvitation(actor: string, tripId: string, requiresApproval = true): Promise<Invitation & { token: string }> {
    return this.database.transaction(async (client) => {
      await this.membership(client, actor, tripId, true);
      const token = randomBytes(32).toString('base64url');
      const id = randomUUID();
      const [row] = await client.query<InvitationRow>(`INSERT INTO goa_core_invitations
        (id, trip_id, token_hash, requires_approval, expires_at, created_by)
        VALUES ($1,$2,$3,$4,now() + interval '7 days',$5) RETURNING *`, [id, tripId, hash(token), requiresApproval, actor]);
      await this.audit(client, actor, tripId, 'invitation.created', id);
      return { ...mapInvitation(row!), token };
    });
  }

  async revokeInvitation(actor: string, tripId: string, invitationId: string): Promise<void> {
    return this.database.transaction(async (client) => {
      await this.membership(client, actor, tripId, true);
      const rows = await client.query(`UPDATE goa_core_invitations SET revoked_at = now()
        WHERE id = $1 AND trip_id = $2 AND revoked_at IS NULL RETURNING id`, [invitationId, tripId]);
      if (rows.length) await this.audit(client, actor, tripId, 'invitation.revoked', invitationId);
    });
  }

  async acceptInvitation(actor: string, token: string): Promise<{ tripId: string; status: 'pending' | 'accepted' }> {
    return this.database.transaction(async (client) => {
      const [lookup] = await client.query<{ trip_id: string }>('SELECT trip_id FROM goa_core_invitations WHERE token_hash=$1', [hash(token)]);
      if (!lookup) throw notFound();
      const trip = await client.query('SELECT id FROM goa_core_trips WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [lookup.trip_id]);
      if (!trip.length) throw notFound();
      const [invitation] = await client.query<InvitationRow>(`SELECT * FROM goa_core_invitations
        WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`, [hash(token)]);
      if (!invitation) throw notFound();
      const [existing] = await client.query<{ status: Status }>(`SELECT status FROM goa_core_memberships
        WHERE trip_id = $1 AND user_id = $2 FOR UPDATE`, [invitation.trip_id, actor]);
      if (existing?.status === 'removed') throw notFound();
      if (existing) return { tripId: invitation.trip_id, status: existing.status as 'pending' | 'accepted' };
      const status = invitation.requires_approval ? 'pending' : 'accepted';
      // ON CONFLICT also protects concurrent use of two different invitation links.
      const inserted = await client.query(`INSERT INTO goa_core_memberships (trip_id,user_id,role,status,joined_at)
        VALUES ($1,$2,'member',$3,CASE WHEN $3 = 'accepted' THEN now() ELSE NULL END)
        ON CONFLICT (trip_id,user_id) DO NOTHING RETURNING user_id`, [invitation.trip_id, actor, status]);
      const [current] = await client.query<{ status: Status }>(`SELECT status FROM goa_core_memberships
        WHERE trip_id = $1 AND user_id = $2 FOR UPDATE`, [invitation.trip_id, actor]);
      if (current!.status === 'removed') throw notFound();
      await client.query(`INSERT INTO goa_core_invitation_acceptances (invitation_id,user_id)
        VALUES ($1,$2) ON CONFLICT (invitation_id,user_id) DO NOTHING`, [invitation.id, actor]);
      if (inserted.length) await this.audit(client, actor, invitation.trip_id, current!.status === 'pending' ? 'membership.requested' : 'membership.accepted', actor);
      return { tripId: invitation.trip_id, status: current!.status as 'pending' | 'accepted' };
    });
  }

  async approveMember(actor: string, tripId: string, userId: string): Promise<Member> {
    return this.database.transaction(async (client) => {
      await this.membership(client, actor, tripId, true);
      const updated = await client.query(`UPDATE goa_core_memberships SET status = 'accepted', joined_at = now()
        WHERE trip_id = $1 AND user_id = $2 AND status = 'pending' RETURNING user_id`, [tripId, userId]);
      const [row] = await client.query<MemberRow>(`SELECT m.user_id,p.display_name,m.role,m.status FROM goa_core_memberships m
        JOIN goa_core_profiles p ON p.id = m.user_id WHERE m.trip_id = $1 AND m.user_id = $2 AND m.status = 'accepted'`, [tripId, userId]);
      if (!row) throw notFound();
      if (updated.length) await this.audit(client, actor, tripId, 'membership.approved', userId);
      return mapMember(row);
    });
  }

  async removeMember(actor: string, tripId: string, userId: string): Promise<void> {
    return this.database.transaction(async (client) => {
      await this.membership(client, actor, tripId, true);
      const [target] = await client.query<{ role: Role }>('SELECT role FROM goa_core_memberships WHERE trip_id = $1 AND user_id = $2 FOR UPDATE', [tripId, userId]);
      if (target?.role === 'organiser') throw new ApiError(409, 'CONFLICT', 'The organiser cannot be removed.');
      const rows = await client.query(`UPDATE goa_core_memberships SET status = 'removed', removed_at = now()
        WHERE trip_id = $1 AND user_id = $2 AND status <> 'removed' RETURNING user_id`, [tripId, userId]);
      if (rows.length) await this.audit(client, actor, tripId, 'membership.removed', userId);
    });
  }
}
