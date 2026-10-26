import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { TripRepository } from './repository.js';
import { ReelIdeaRepository } from './reel-idea-repository.js';
import type { ReelIdeaInput } from './reel-idea-types.js';
import { noBody, nullable, object, params, retryKey, text, uuidSchema, versionSchema } from './validation.js';

const properties = {
  title: text(160, 1),
  kind: { type: 'string', enum: ['reel', 'photo'] },
  instagramUrl: nullable(text(2048)),
  location: text(200),
  notes: text(4000),
  participantUserIds: { type: 'array', minItems: 1, maxItems: 100, items: uuidSchema },
};
const fields = Object.keys(properties);
type TripParams = { tripId: string };
type IdeaParams = TripParams & { ideaId: string };
const actor = (request: FastifyRequest) => request.user!.id;

export function registerReelIdeaRoutes(app: FastifyInstance, core: TripRepository): void {
  const ideas = new ReelIdeaRepository(core);
  const limit = (request: FastifyRequest) => core.rateLimit('reel-idea-write', actor(request), 100);
  app.get<{ Params: TripParams }>('/v1/trips/:tripId/reel-ideas', {
    schema: { params: params(['tripId']) },
  }, async (request) => ({ ideas: await ideas.list(actor(request), request.params.tripId) }));

  app.post<{ Params: TripParams; Body: ReelIdeaInput }>('/v1/trips/:tripId/reel-ideas', {
    schema: { params: params(['tripId']), body: object(properties, fields) },
  }, async (request, reply) => {
    const key = retryKey(request);
    await limit(request);
    return reply.status(201).send({ idea: await ideas.create(actor(request), request.params.tripId, request.body, key) });
  });

  app.patch<{ Params: IdeaParams; Body: ReelIdeaInput & { version: number } }>('/v1/trips/:tripId/reel-ideas/:ideaId', {
    schema: { params: params(['tripId', 'ideaId']), body: object({ ...properties, version: versionSchema }, [...fields, 'version']) },
  }, async (request) => {
    await limit(request);
    return { idea: await ideas.update(actor(request), request.params.tripId, request.params.ideaId, request.body) };
  });

  app.delete<{ Params: IdeaParams }>('/v1/trips/:tripId/reel-ideas/:ideaId', {
    schema: { params: params(['tripId', 'ideaId']) }, preValidation: async (request) => noBody(request),
  }, async (request, reply) => {
    await limit(request);
    await ideas.delete(actor(request), request.params.tripId, request.params.ideaId);
    return reply.status(204).send();
  });
}
