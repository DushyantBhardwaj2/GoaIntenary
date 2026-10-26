import type { FastifyInstance, FastifyRequest } from 'fastify';
import { OverviewRepository } from './overview-repository.js';
import type { TripRepository } from './repository.js';
import { params } from './validation.js';

type TripParams = { tripId: string };
const actor = (request: FastifyRequest) => request.user!.id;

export function registerOverviewRoutes(app: FastifyInstance, core: TripRepository): void {
  const overview = new OverviewRepository(core);
  app.get<{ Params: TripParams }>('/v1/trips/:tripId/overview', { schema: { params: params(['tripId']) } },
    async (request) => overview.get(actor(request), request.params.tripId));
}
