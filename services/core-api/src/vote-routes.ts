import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TripRepository } from './repository.js';
import type { PlaceVoteInput } from './trip-planning-types.js';
import { voteProperties } from './trip-planning-validation.js';
import { params } from './validation.js';
import { VoteRepository } from './vote-repository.js';

type PlaceParams = { tripId: string; placeId: string };
const actor = (request: FastifyRequest) => request.user!.id;

export function registerVoteRoutes(app: FastifyInstance, core: TripRepository): void {
  const votes = new VoteRepository(core);
  const limit = (request: FastifyRequest) => core.rateLimit('vote-write', actor(request), 100);

  app.get<{ Params: PlaceParams }>('/v1/trips/:tripId/saved-places/:placeId/votes', {
    schema: { params: params(['tripId', 'placeId']) },
  }, async (request) => votes.getVotes(actor(request), request.params.tripId, request.params.placeId));

  app.put<{ Params: PlaceParams; Body: PlaceVoteInput }>('/v1/trips/:tripId/saved-places/:placeId/votes', {
    schema: { params: params(['tripId', 'placeId']), body: voteProperties },
  }, async (request) => {
    await limit(request);
    return votes.setVote(actor(request), request.params.tripId, request.params.placeId, request.body);
  });
}
