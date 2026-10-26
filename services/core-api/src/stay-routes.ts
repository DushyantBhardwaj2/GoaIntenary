import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TripRepository } from './repository.js';
import { StayRepository, type StayBody } from './stay-repository.js';
import { stayProperties } from './trip-planning-validation.js';
import { noBody, params, retryKey } from './validation.js';

type TripParams = { tripId: string };
type StayParams = TripParams & { stayId: string };
const actor = (request: FastifyRequest) => request.user!.id;

export function registerStayRoutes(app: FastifyInstance, core: TripRepository): void {
  const stays = new StayRepository(core);
  const limit = (request: FastifyRequest) => core.rateLimit('stay-write', actor(request), 100);
  app.get<{ Params: TripParams }>('/v1/trips/:tripId/stays', { schema: { params: params(['tripId']) } },
    async (request) => ({ stays: await stays.list(actor(request), request.params.tripId) }));
  app.post<{ Params: TripParams; Body: StayBody }>('/v1/trips/:tripId/stays', {
    schema: { params: params(['tripId']), body: stayProperties },
  }, async (request, reply) => {
    const key = retryKey(request);
    await limit(request);
    return reply.status(201).send({ stay: await stays.create(actor(request), request.params.tripId, request.body, key) });
  });
  app.patch<{ Params: StayParams; Body: StayBody }>('/v1/trips/:tripId/stays/:stayId', {
    schema: { params: params(['tripId', 'stayId']), body: stayProperties },
  }, async (request) => {
    await limit(request);
    return { stay: await stays.update(actor(request), request.params.tripId, request.params.stayId, request.body) };
  });
  app.delete<{ Params: StayParams }>('/v1/trips/:tripId/stays/:stayId', {
    schema: { params: params(['tripId', 'stayId']) }, preValidation: async (request) => noBody(request),
  }, async (request, reply) => {
    await limit(request);
    await stays.remove(actor(request), request.params.tripId, request.params.stayId);
    return reply.status(204).send();
  });
}
