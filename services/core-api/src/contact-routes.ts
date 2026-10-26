import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ContactRepository, type ContactWrite } from './contact-repository.js';
import type { TripRepository } from './repository.js';
import { contactProperties } from './trip-planning-validation.js';
import { noBody, params, retryKey } from './validation.js';

type TripParams = { tripId: string };
type ContactParams = TripParams & { contactId: string };
const actor = (request: FastifyRequest) => request.user!.id;

export function registerContactRoutes(app: FastifyInstance, core: TripRepository): void {
  const contacts = new ContactRepository(core);
  const limit = (request: FastifyRequest) => core.rateLimit('contact-write', actor(request), 100);

  app.get<{ Params: TripParams }>('/v1/trips/:tripId/contacts', { schema: { params: params(['tripId']) } },
    async (request) => ({ contacts: await contacts.listContacts(actor(request), request.params.tripId) }));

  app.post<{ Params: TripParams; Body: ContactWrite }>('/v1/trips/:tripId/contacts', {
    schema: { params: params(['tripId']), body: contactProperties },
  }, async (request, reply) => {
    const key = retryKey(request);
    await limit(request);
    return reply.status(201).send({ contact: await contacts.createContact(actor(request), request.params.tripId, request.body, key) });
  });

  app.patch<{ Params: ContactParams; Body: ContactWrite }>('/v1/trips/:tripId/contacts/:contactId', {
    schema: { params: params(['tripId', 'contactId']), body: contactProperties },
  }, async (request) => {
    await limit(request);
    return { contact: await contacts.updateContact(actor(request), request.params.tripId, request.params.contactId, request.body) };
  });

  app.delete<{ Params: ContactParams }>('/v1/trips/:tripId/contacts/:contactId', {
    schema: { params: params(['tripId', 'contactId']) }, preValidation: async (request) => noBody(request),
  }, async (request, reply) => {
    await limit(request);
    await contacts.deleteContact(actor(request), request.params.tripId, request.params.contactId);
    return reply.status(204).send();
  });
}
