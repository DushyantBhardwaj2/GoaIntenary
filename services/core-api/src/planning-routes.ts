import type { FastifyInstance, FastifyRequest } from 'fastify';
import { PlanningRepository } from './planning-repository.js';
import { LedgerRepository } from './ledger-repository.js';
import type { TripRepository } from './repository.js';
import type { ActivityInput, CreateTrip, ExpenseInput, RepaymentInput, SavedPlaceInput } from './types.js';
import { activityProperties, dateSchema, expenseProperties, moneySchema, noBody, nullable, object, params, retryKey, savedPlaceProperties, text, tripProperties, uuidSchema, versionSchema } from './validation.js';

type TripParams = { tripId: string };
type ActivityParams = TripParams & { activityId: string };
type ExpenseParams = TripParams & { expenseId: string };
const actor = (request: FastifyRequest) => request.user!.id;

export function registerPlanningRoutes(app: FastifyInstance, core: TripRepository): void {
  const planner = new PlanningRepository(core);
  const ledger = new LedgerRepository(core);
  const limit = (request: FastifyRequest) => core.rateLimit('planner-write',actor(request),100);
  app.patch<{ Params: TripParams; Body: Partial<CreateTrip> }>('/v1/trips/:tripId', {
    schema: { params: params(['tripId']), body: { ...object(tripProperties), minProperties: 1 } },
  }, async (request) => { await limit(request); return { trip: await planner.updateTrip(actor(request),request.params.tripId,request.body) }; });
  app.delete<{ Params: TripParams }>('/v1/trips/:tripId', {
    schema: { params: params(['tripId']) }, preValidation: async (request) => noBody(request),
  }, async (request,reply) => { await limit(request); await planner.deleteTrip(actor(request),request.params.tripId); return reply.status(204).send(); });

  app.get<{ Params: TripParams }>('/v1/trips/:tripId/activities', { schema: { params: params(['tripId']) } },
    async (request) => ({ activities: await planner.listActivities(actor(request),request.params.tripId) }));
  app.post<{ Params: TripParams; Body: Partial<ActivityInput> & { title: string } }>('/v1/trips/:tripId/activities', {
    schema: { params: params(['tripId']), body: object(activityProperties,['title']) },
  }, async (request,reply) => {
    const key = retryKey(request); await limit(request);
    return reply.status(201).send({ activity: await planner.createActivity(actor(request),request.params.tripId,request.body,key) });
  });
  app.patch<{ Params: ActivityParams; Body: Partial<ActivityInput> & { version: number } }>('/v1/trips/:tripId/activities/:activityId', {
    schema: { params: params(['tripId','activityId']), body: object({ ...activityProperties,version: versionSchema },['version']) },
  }, async (request) => { await limit(request); return { activity: await planner.updateActivity(actor(request),request.params.tripId,request.params.activityId,request.body) }; });
  app.delete<{ Params: ActivityParams }>('/v1/trips/:tripId/activities/:activityId', {
    schema: { params: params(['tripId','activityId']) }, preValidation: async (request) => noBody(request),
  }, async (request,reply) => { await limit(request); await planner.deleteActivity(actor(request),request.params.tripId,request.params.activityId); return reply.status(204).send(); });
  app.post<{ Params: TripParams; Body: { day: string | null; activityIds: string[] } }>('/v1/trips/:tripId/activities/reorder', {
    schema: { params: params(['tripId']), body: object({ day: nullable(dateSchema),activityIds: { type: 'array',maxItems: 2000,items: uuidSchema } },['day','activityIds']) },
  }, async (request) => { await limit(request); return { activities: await planner.reorder(actor(request),request.params.tripId,request.body.day,request.body.activityIds) }; });

  app.get<{ Params: TripParams }>('/v1/trips/:tripId/saved-places', { schema: { params: params(['tripId']) } },
    async (request) => ({ places: await planner.listPlaces(actor(request),request.params.tripId) }));
  app.post<{ Params: TripParams; Body: SavedPlaceInput }>('/v1/trips/:tripId/saved-places', {
    schema: { params: params(['tripId']), body: object(savedPlaceProperties,Object.keys(savedPlaceProperties)) },
  }, async (request) => { await limit(request); return { place: await planner.savePlace(actor(request),request.params.tripId,request.body) }; });
  app.delete<{ Params: TripParams & { placeId: string } }>('/v1/trips/:tripId/saved-places/:placeId', {
    schema: { params: params(['tripId','placeId']) }, preValidation: async (request) => noBody(request),
  }, async (request,reply) => { await limit(request); await planner.unsavePlace(actor(request),request.params.tripId,request.params.placeId); return reply.status(204).send(); });

  app.get<{ Params: TripParams }>('/v1/trips/:tripId/budget', { schema: { params: params(['tripId']) } },
    async (request) => planner.budget(actor(request),request.params.tripId));
  app.post<{ Params: TripParams; Body: ExpenseInput }>('/v1/trips/:tripId/expenses', {
    schema: { params: params(['tripId']), body: object(expenseProperties,['title','amountPaise','category','date']) },
  }, async (request,reply) => {
    const key = retryKey(request); await limit(request);
    return reply.status(201).send({ expense: await ledger.createExpense(actor(request),request.params.tripId,request.body,key) });
  });
  app.patch<{ Params: ExpenseParams; Body: Partial<ExpenseInput> & { version: number } }>('/v1/trips/:tripId/expenses/:expenseId', {
    schema: { params: params(['tripId','expenseId']), body: object({ ...expenseProperties,version: versionSchema },['version']) },
  }, async (request) => { await limit(request); return { expense: await ledger.updateExpense(actor(request),request.params.tripId,request.params.expenseId,request.body) }; });
  app.delete<{ Params: ExpenseParams; Querystring: { acknowledgeSettlementChange?: string } }>('/v1/trips/:tripId/expenses/:expenseId', {
    schema: { params: params(['tripId','expenseId']),querystring: object({acknowledgeSettlementChange:{type:'string',enum:['true']}}) }, preValidation: async (request) => noBody(request),
  }, async (request,reply) => { await limit(request); await ledger.deleteExpense(actor(request),request.params.tripId,request.params.expenseId,request.query.acknowledgeSettlementChange==='true'); return reply.status(204).send(); });

  app.get<{Params:TripParams}>('/v1/trips/:tripId/expense-participants',{schema:{params:params(['tripId'])}},async request=>({participants:await ledger.listParticipants(actor(request),request.params.tripId)}));
  app.post<{Params:TripParams;Body:{displayName:string}}>('/v1/trips/:tripId/expense-participants',{schema:{params:params(['tripId']),body:object({displayName:text(80,1)},['displayName'])}},async(request,reply)=>{
    await limit(request);return reply.status(201).send({participant:await ledger.addGuest(actor(request),request.params.tripId,request.body.displayName,retryKey(request))});
  });
  app.delete<{Params:TripParams&{participantId:string}}>('/v1/trips/:tripId/expense-participants/:participantId',{schema:{params:params(['tripId','participantId'])},preValidation:async request=>noBody(request)},async(request,reply)=>{
    await limit(request);await ledger.archiveGuest(actor(request),request.params.tripId,request.params.participantId);return reply.status(204).send();
  });
  app.get<{Params:TripParams}>('/v1/trips/:tripId/ledger',{schema:{params:params(['tripId'])}},async request=>ledger.getLedger(actor(request),request.params.tripId));
  app.post<{Params:TripParams;Body:RepaymentInput}>('/v1/trips/:tripId/repayments',{schema:{params:params(['tripId']),body:object({fromParticipantId:uuidSchema,toParticipantId:uuidSchema,amountPaise:{...moneySchema,minimum:1},date:dateSchema,note:text(500)},['fromParticipantId','toParticipantId','amountPaise','date'])}},async(request,reply)=>{
    await limit(request);return reply.status(201).send({repayment:await ledger.createRepayment(actor(request),request.params.tripId,request.body,retryKey(request))});
  });
  app.delete<{Params:TripParams&{repaymentId:string}}>('/v1/trips/:tripId/repayments/:repaymentId',{schema:{params:params(['tripId','repaymentId'])},preValidation:async request=>noBody(request)},async(request,reply)=>{
    await limit(request);await ledger.deleteRepayment(actor(request),request.params.tripId,request.params.repaymentId);return reply.status(204).send();
  });
}
