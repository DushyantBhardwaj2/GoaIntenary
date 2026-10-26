import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TripRepository } from './repository.js';
import { TravelRepository, type TravelWrite } from './travel-repository.js';
import { travelProperties } from './trip-planning-validation.js';
import { noBody, params, retryKey } from './validation.js';

type TripParams = { tripId: string };
type SegmentParams = TripParams & { segmentId: string };
const actor = (request: FastifyRequest) => request.user!.id;

export function registerTravelRoutes(app: FastifyInstance, core: TripRepository): void {
  const travel = new TravelRepository(core);
  const limit = (request: FastifyRequest) => core.rateLimit('travel-write', actor(request), 100);

  app.get<{ Params: TripParams }>('/v1/trips/:tripId/travel', { schema: { params: params(['tripId']) } },
    async (request) => ({ segments: await travel.list(actor(request), request.params.tripId) }));

  app.post<{ Params: TripParams; Body: TravelWrite }>('/v1/trips/:tripId/travel', {
    schema: { params: params(['tripId']), body: travelProperties },
  }, async (request, reply) => {
    const key = retryKey(request);
    await limit(request);
    return reply.status(201).send({ segment: await travel.create(actor(request), request.params.tripId, request.body, key) });
  });

  app.patch<{ Params: SegmentParams; Body: TravelWrite }>('/v1/trips/:tripId/travel/:segmentId', {
    schema: { params: params(['tripId', 'segmentId']), body: travelProperties },
  }, async (request) => {
    await limit(request);
    return { segment: await travel.update(actor(request), request.params.tripId, request.params.segmentId, request.body) };
  });

  app.delete<{ Params: SegmentParams }>('/v1/trips/:tripId/travel/:segmentId', {
    schema: { params: params(['tripId', 'segmentId']) }, preValidation: async (request) => noBody(request),
  }, async (request, reply) => {
    await limit(request);
    await travel.remove(actor(request), request.params.tripId, request.params.segmentId);
    return reply.status(204).send();
  });
}
