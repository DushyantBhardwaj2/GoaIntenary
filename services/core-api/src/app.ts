import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance, type FastifyRequest } from 'fastify';
import { createAuthenticator, uuidPattern, type Authenticate } from './auth.js';
import { loadConfig, type CoreConfig } from './config.js';
import { latestMigration, migrate, openDatabase, type Database, type DatabaseRequestScope } from './database.js';
import { ApiError, invalid, notFound, unauthenticated } from './errors.js';
import { TripRepository } from './repository.js';
import type { CreateTrip, User } from './types.js';
import { registerPlanningRoutes } from './planning-routes.js';
import { registerTripPlanningRoutes } from './trip-planning-routes.js';
import { noBody, object, params, tripProperties, validateTrip } from './validation.js';

declare module 'fastify' { interface FastifyRequest { user: User | null } }
export interface AppOptions {
  config?: CoreConfig;
  database?: Database;
  authenticate?: Authenticate;
  /** Only local startup auto-migrates. Cloud deployment runs db:migrate first. */
  runMigrations?: boolean;
  logger?: boolean;
}
type TripParams = { tripId: string };
type InvitationParams = TripParams & { invitationId: string };
type MemberParams = TripParams & { userId: string };
const actor = (request: FastifyRequest) => request.user!.id;

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const config = options.config || loadConfig();
  const database = options.database || await openDatabase(config);
  const ownsDatabase = !options.database;
  try {
    if (options.runMigrations ?? (!config.production && !config.lambda)) await migrate(database);
  } catch (error) {
    if (ownsDatabase) await database.close();
    throw error;
  }
  const repository = new TripRepository(database);
  let authenticate: Authenticate;
  try { authenticate = options.authenticate || createAuthenticator(config); }
  catch (error) { if (ownsDatabase) await database.close(); throw error; }
  const app = Fastify({
    logger: options.logger === false ? false : { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'] },
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    bodyLimit: 16_384,
    trustProxy: false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } },
  });
  app.decorateRequest('user', null);
  app.addHook('onClose', async () => { if (ownsDatabase) await database.close(); });
  if (database.createRequestScope) {
    const scopes = new WeakMap<FastifyRequest, DatabaseRequestScope>();
    app.addHook('onRequest', (request, _reply, done) => {
      const scope = database.createRequestScope!();
      scopes.set(request, scope);
      // Callback style is required: downstream async work must be created
      // inside the request's AsyncLocalStorage context.
      scope.run(done);
    });
    const closeScope = async (request: FastifyRequest) => { await scopes.get(request)?.close(); };
    // Release before the response resolves, including in Lambda environments
    // which can freeze before an idle timer or onResponse callback completes.
    app.addHook('onSend', async (request, _reply, payload) => { await closeScope(request); return payload; });
    app.addHook('onResponse', closeScope);
    app.addHook('onTimeout', closeScope);
    app.addHook('onRequestAbort', closeScope);
  }
  let nextPrune = 0;
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store, max-age=0');
    reply.header('Pragma', 'no-cache');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (request.routeOptions.url === '/health' && request.method === 'GET') return;
    // request.ip is the socket IP. Untrusted X-Forwarded-For is not enabled.
    await repository.rateLimit('authenticated-api', request.ip, 180);
    const authorization = request.headers.authorization;
    if (!authorization || authorization.length > 16_384 || !/^Bearer \S+$/.test(authorization)) throw unauthenticated();
    const identity = await authenticate(authorization.slice(7), request.ip);
    request.user = await repository.resolveProfile(identity);
    if (Date.now() >= nextPrune) {
      nextPrune = Date.now() + 60 * 60_000;
      await repository.pruneRateLimits();
    }
  });
  app.addHook('onResponse', async (request, reply) => {
    app.log.info({ requestId: request.id, method: request.method, route: request.routeOptions.url || 'unknown', statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime) }, 'API request completed');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      if (error.statusCode === 429) reply.header('Retry-After', '60');
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    const frameworkError = (error || {}) as { validation?: unknown; code?: string };
    if (frameworkError.validation || ['FST_ERR_CTP_INVALID_JSON_BODY', 'FST_ERR_CTP_EMPTY_JSON_BODY', 'FST_ERR_CTP_INVALID_MEDIA_TYPE', 'FST_ERR_CTP_BODY_TOO_LARGE'].includes(frameworkError.code || '')) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Check the supplied information.' } });
    }
    // Logging Error objects risks leaking SQL parameters or authentication data.
    app.log.error({ requestId: request.id, code: 'SERVICE_UNAVAILABLE' }, 'API operation unavailable');
    return reply.status(503).send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Unable to complete this request. Please try again.' } });
  });
  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'That resource is unavailable.' } }));

  app.get('/health', async () => {
    const applied = await database.query('SELECT version FROM goa_core_migrations WHERE version = $1', [latestMigration]);
    if (!applied.length) throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'The service is not ready.');
    return { status: 'ok', authMode: config.localDemo ? 'local' : 'cognito', storage: database.storage };
  });
  app.get('/v1/me', async (request) => ({ user: request.user }));
  app.get('/v1/trips', async (request) => ({ trips: await repository.listTrips(actor(request)) }));
  app.post<{ Body: CreateTrip }>('/v1/trips', {
    schema: { body: object(tripProperties, ['name', 'startDate', 'endDate']) },
  }, async (request, reply) => {
    const input = request.body;
    validateTrip(input);
    const retryKey = request.headers['idempotency-key'];
    if (retryKey !== undefined && (typeof retryKey !== 'string' || !uuidPattern.test(retryKey))) throw invalid('Use a valid retry key.');
    await repository.rateLimit('trip-create', actor(request), 20);
    const trip = await repository.createTrip(actor(request), input, retryKey?.toLowerCase());
    return reply.status(201).send({ trip });
  });
  app.get<{ Params: TripParams }>('/v1/trips/:tripId', { schema: { params: params(['tripId']) } },
    async (request) => repository.getTrip(actor(request), request.params.tripId));
  app.post<{ Params: TripParams; Body: { requiresApproval?: boolean } }>('/v1/trips/:tripId/invitations', {
    schema: { params: params(['tripId']), body: object({ requiresApproval: { type: 'boolean' } }) },
  }, async (request, reply) => {
    await repository.rateLimit('invitation-create', actor(request), 20);
    const invitation = await repository.createInvitation(actor(request), request.params.tripId, request.body.requiresApproval ?? true);
    return reply.status(201).send({ invitation });
  });
  app.delete<{ Params: InvitationParams }>('/v1/trips/:tripId/invitations/:invitationId', {
    schema: { params: params(['tripId', 'invitationId']) }, preValidation: async (request) => noBody(request),
  }, async (request, reply) => {
    await repository.rateLimit('invitation-revoke', actor(request), 40);
    await repository.revokeInvitation(actor(request), request.params.tripId, request.params.invitationId);
    return reply.status(204).send();
  });
  app.post<{ Body: { token: string } }>('/v1/invitations/accept', {
    schema: { body: object({ token: { type: 'string', minLength: 1, maxLength: 256 } }, ['token']) },
  }, async (request) => {
    await repository.rateLimit('invitation-accept', actor(request), 30);
    if (!/^[A-Za-z0-9_-]{43}$/.test(request.body.token)) throw notFound();
    return repository.acceptInvitation(actor(request), request.body.token);
  });
  app.post<{ Params: MemberParams }>('/v1/trips/:tripId/members/:userId/approve', {
    schema: { params: params(['tripId', 'userId']) }, preValidation: async (request) => noBody(request),
  }, async (request) => {
    await repository.rateLimit('member-approve', actor(request), 40);
    return { member: await repository.approveMember(actor(request), request.params.tripId, request.params.userId) };
  });
  app.delete<{ Params: MemberParams }>('/v1/trips/:tripId/members/:userId', {
    schema: { params: params(['tripId', 'userId']) }, preValidation: async (request) => noBody(request),
  }, async (request, reply) => {
    await repository.rateLimit('member-remove', actor(request), 40);
    await repository.removeMember(actor(request), request.params.tripId, request.params.userId);
    return reply.status(204).send();
  });
  registerPlanningRoutes(app,repository);
  registerTripPlanningRoutes(app, repository);
  return app;
}
