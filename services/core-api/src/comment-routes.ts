import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CommentRepository } from './comment-repository.js';
import type { TripRepository } from './repository.js';
import type { ActivityCommentInput } from './trip-planning-types.js';
import { commentProperties } from './trip-planning-validation.js';
import { noBody, params } from './validation.js';

type ActivityParams = { tripId: string; activityId: string };
type CommentParams = ActivityParams & { commentId: string };
const actor = (request: FastifyRequest) => request.user!.id;

export function registerCommentRoutes(app: FastifyInstance, core: TripRepository): void {
  const comments = new CommentRepository(core);
  const limit = (request: FastifyRequest) => core.rateLimit('comment-write', actor(request), 100);

  app.get<{ Params: ActivityParams }>('/v1/trips/:tripId/activities/:activityId/comments', {
    schema: { params: params(['tripId', 'activityId']) },
  }, async (request) => ({ comments: await comments.listComments(actor(request), request.params.tripId, request.params.activityId) }));

  app.post<{ Params: ActivityParams; Body: ActivityCommentInput }>('/v1/trips/:tripId/activities/:activityId/comments', {
    schema: { params: params(['tripId', 'activityId']), body: commentProperties },
  }, async (request, reply) => {
    await limit(request);
    return reply.status(201).send({ comment: await comments.createComment(actor(request), request.params.tripId, request.params.activityId, request.body) });
  });

  app.patch<{ Params: CommentParams; Body: ActivityCommentInput }>('/v1/trips/:tripId/activities/:activityId/comments/:commentId', {
    schema: { params: params(['tripId', 'activityId', 'commentId']), body: commentProperties },
  }, async (request) => {
    await limit(request);
    return { comment: await comments.updateComment(actor(request), request.params.tripId, request.params.activityId, request.params.commentId, request.body) };
  });

  app.delete<{ Params: CommentParams }>('/v1/trips/:tripId/activities/:activityId/comments/:commentId', {
    schema: { params: params(['tripId', 'activityId', 'commentId']) }, preValidation: async (request) => noBody(request),
  }, async (request, reply) => {
    await limit(request);
    await comments.deleteComment(actor(request), request.params.tripId, request.params.activityId, request.params.commentId);
    return reply.status(204).send();
  });
}
