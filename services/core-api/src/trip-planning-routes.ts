import type { FastifyInstance } from 'fastify';
import type { TripRepository } from './repository.js';
import { registerTravelRoutes } from './travel-routes.js';
import { registerStayRoutes } from './stay-routes.js';
import { registerBookingRoutes } from './booking-routes.js';
import { registerContactRoutes } from './contact-routes.js';
import { registerVoteRoutes } from './vote-routes.js';
import { registerCommentRoutes } from './comment-routes.js';
import { registerActivityExtraRoutes } from './activity-extra-routes.js';
import { registerBudgetLimitRoutes } from './budget-limit-routes.js';
import { registerChecklistRoutes } from './checklist-routes.js';
import { registerOverviewRoutes } from './overview-routes.js';

export function registerTripPlanningRoutes(app: FastifyInstance, core: TripRepository): void {
  registerTravelRoutes(app, core);
  registerStayRoutes(app, core);
  registerBookingRoutes(app, core);
  registerContactRoutes(app, core);
  registerVoteRoutes(app, core);
  registerCommentRoutes(app, core);
  registerActivityExtraRoutes(app, core);
  registerBudgetLimitRoutes(app, core);
  registerChecklistRoutes(app, core);
  registerOverviewRoutes(app, core);
}
