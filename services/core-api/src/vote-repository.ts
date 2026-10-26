import type { SqlClient } from './database.js';
import { notFound } from './errors.js';
import type { TripRepository } from './repository.js';
import type { PlaceVoteInput, PlaceVoteSummary } from './trip-planning-types.js';

type VoterRow = { userId: string; displayName: string };

async function requireSavedPlace(client: SqlClient, tripId: string, placeId: string): Promise<void> {
  const rows = await client.query('SELECT place_id FROM goa_core_saved_places WHERE trip_id=$1 AND place_id=$2 FOR UPDATE', [tripId, placeId]);
  if (!rows.length) throw notFound();
}

async function voteSummary(client: SqlClient, tripId: string, placeId: string): Promise<PlaceVoteSummary> {
  const voters = await client.query<VoterRow>(`SELECT v.user_id AS "userId", p.display_name AS "displayName"
    FROM goa_core_place_votes v JOIN goa_core_profiles p ON p.id = v.user_id
    WHERE v.trip_id=$1 AND v.place_id=$2
    ORDER BY p.display_name, v.user_id`, [tripId, placeId]);
  return { count: voters.length, voters };
}

export async function removeVotesForPlace(client: SqlClient, tripId: string, placeId: string): Promise<void> {
  await client.query('DELETE FROM goa_core_place_votes WHERE trip_id=$1 AND place_id=$2', [tripId, placeId]);
}

export class VoteRepository {
  constructor(private readonly core: TripRepository) {}

  async getVotes(actor: string, tripId: string, placeId: string): Promise<PlaceVoteSummary> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      await requireSavedPlace(client, tripId, placeId);
      return voteSummary(client, tripId, placeId);
    });
  }

  async setVote(actor: string, tripId: string, placeId: string, input: PlaceVoteInput): Promise<PlaceVoteSummary> {
    return this.core.database.transaction(async (client) => {
      await this.core.membership(client, actor, tripId);
      await requireSavedPlace(client, tripId, placeId);
      if (input.interested) {
        const inserted = await client.query(`INSERT INTO goa_core_place_votes (trip_id, place_id, user_id)
          VALUES ($1,$2,$3) ON CONFLICT (trip_id, place_id, user_id) DO NOTHING RETURNING user_id`, [tripId, placeId, actor]);
        if (inserted.length) await this.core.audit(client, actor, tripId, 'vote.cast', tripId, placeId);
      } else {
        const removed = await client.query('DELETE FROM goa_core_place_votes WHERE trip_id=$1 AND place_id=$2 AND user_id=$3 RETURNING user_id', [tripId, placeId, actor]);
        if (removed.length) await this.core.audit(client, actor, tripId, 'vote.withdrawn', tripId, placeId);
      }
      return voteSummary(client, tripId, placeId);
    });
  }
}
