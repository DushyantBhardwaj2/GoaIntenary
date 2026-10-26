import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ActivityExtraRepository } from './activity-extra-repository.js';
import type { TripRepository } from './repository.js';
import type { ActivityAttendees, ActivityStatusInput } from './trip-planning-types.js';
import { activityStatusProperties, attendeesProperties } from './trip-planning-validation.js';
import { params } from './validation.js';

type ActivityParams = { tripId: string; activityId: string };
const actor = (request: FastifyRequest) => request.user!.id;

export function registerActivityExtraRoutes(app: FastifyInstance, core: TripRepository): void {
  const extras = new ActivityExtraRepository(core);
  const limit = (request: FastifyRequest) => core.rateLimit('activity-extra-write', actor(request), 100);

  app.get<{ Params: ActivityParams }>('/v1/trips/:tripId/activities/:activityId/status', {
    schema: { params: params(['tripId', 'activityId']) },
  }, async (request) => extras.getStatus(actor(request), request.params.tripId, request.params.activityId));

  app.put<{ Params: ActivityParams; Body: ActivityStatusInput }>('/v1/trips/:tripId/activities/:activityId/status', {
    schema: { params: params(['tripId', 'activityId']), body: activityStatusProperties },
  }, async (request) => {
    await limit(request);
    return extras.setStatus(actor(request), request.params.tripId, request.params.activityId, request.body);
  });

  app.get<{ Params: ActivityParams }>('/v1/trips/:tripId/activities/:activityId/attendees', {
    schema: { params: params(['tripId', 'activityId']) },
  }, async (request) => extras.getAttendees(actor(request), request.params.tripId, request.params.activityId));

  app.put<{ Params: ActivityParams; Body: ActivityAttendees }>('/v1/trips/:tripId/activities/:activityId/attendees', {
    schema: { params: params(['tripId', 'activityId']), body: attendeesProperties },
  }, async (request) => {
    await limit(request);
    return extras.setAttendees(actor(request), request.params.tripId, request.params.activityId, request.body);
  });
}
