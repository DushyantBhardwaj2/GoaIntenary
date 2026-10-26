import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ChecklistRepository, type ChecklistWrite } from './checklist-repository.js';
import type { TripRepository } from './repository.js';
import type { ChecklistPatch } from './trip-planning-types.js';
import { checklistPatchProperties, checklistProperties } from './trip-planning-validation.js';
import { noBody, params, retryKey } from './validation.js';

type TripParams = { tripId: string };
type ItemParams = TripParams & { itemId: string };
const actor = (request: FastifyRequest) => request.user!.id;

export function registerChecklistRoutes(app: FastifyInstance, core: TripRepository): void {
  const checklists = new ChecklistRepository(core);
  const limit = (request: FastifyRequest) => core.rateLimit('checklist-write', actor(request), 100);

  app.get<{ Params: TripParams }>('/v1/trips/:tripId/checklist', { schema: { params: params(['tripId']) } },
    async (request) => ({ items: await checklists.listItems(actor(request), request.params.tripId) }));

  app.post<{ Params: TripParams; Body: ChecklistWrite }>('/v1/trips/:tripId/checklist', {
    schema: { params: params(['tripId']), body: checklistProperties },
  }, async (request, reply) => {
    const key = retryKey(request);
    await limit(request);
    return reply.status(201).send({ item: await checklists.createItem(actor(request), request.params.tripId, request.body, key) });
  });

  app.patch<{ Params: ItemParams; Body: ChecklistPatch }>('/v1/trips/:tripId/checklist/:itemId', {
    schema: { params: params(['tripId', 'itemId']), body: checklistPatchProperties },
  }, async (request) => {
    await limit(request);
    return { item: await checklists.updateItem(actor(request), request.params.tripId, request.params.itemId, request.body) };
  });

  app.delete<{ Params: ItemParams }>('/v1/trips/:tripId/checklist/:itemId', {
    schema: { params: params(['tripId', 'itemId']) }, preValidation: async (request) => noBody(request),
  }, async (request, reply) => {
    await limit(request);
    await checklists.deleteItem(actor(request), request.params.tripId, request.params.itemId);
    return reply.status(204).send();
  });
}
