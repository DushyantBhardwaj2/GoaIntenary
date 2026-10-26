import type { FastifyInstance, FastifyRequest } from 'fastify';
import { BudgetLimitRepository } from './budget-limit-repository.js';
import type { TripRepository } from './repository.js';
import type { CategoryLimitsInput } from './trip-planning-types.js';
import { categoryLimitsProperties } from './trip-planning-validation.js';
import { params } from './validation.js';

type TripParams = { tripId: string };
const actor = (request: FastifyRequest) => request.user!.id;

export function registerBudgetLimitRoutes(app: FastifyInstance, core: TripRepository): void {
  const limits = new BudgetLimitRepository(core);
  const limit = (request: FastifyRequest) => core.rateLimit('budget-limit-write', actor(request), 100);

  app.put<{ Params: TripParams; Body: CategoryLimitsInput }>('/v1/trips/:tripId/budget/category-limits', {
    schema: { params: params(['tripId']), body: categoryLimitsProperties },
  }, async (request) => {
    await limit(request);
    return { limits: await limits.setCategoryLimits(actor(request), request.params.tripId, request.body) };
  });
}
