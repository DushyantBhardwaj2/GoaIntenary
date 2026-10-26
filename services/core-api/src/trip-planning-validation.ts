import { moneySchema, nullable, object, text, uuidSchema } from './validation.js';

export const travelProperties = object({
  mode: { type: 'string', enum: ['flight', 'train', 'bus'] },
  title: text(160, 1),
  departurePlace: text(200, 1),
  arrivalPlace: text(200, 1),
  departureAt: { type: 'string', minLength: 1 },
  arrivalAt: nullable({ type: 'string', minLength: 1 }),
  departureTerminal: text(120),
  arrivalTerminal: text(120),
  bookingReference: text(80),
  notes: text(2000),
  travellerIds: { type: 'array', items: uuidSchema },
}, ['mode', 'title', 'departurePlace', 'arrivalPlace', 'departureAt', 'travellerIds']);

export const stayProperties = object({
  propertyName: text(160, 1),
  address: text(300),
  latitude: nullable({ type: 'number', minimum: -90, maximum: 90 }),
  longitude: nullable({ type: 'number', minimum: -180, maximum: 180 }),
  checkIn: { type: 'string', minLength: 1 },
  checkOut: { type: 'string', minLength: 1 },
  phone: text(40),
  contactName: text(160),
  notes: text(2000),
  guestIds: { type: 'array', items: uuidSchema },
}, ['propertyName', 'checkIn', 'checkOut', 'guestIds']);

export const bookingProperties = object({
  targetType: { type: 'string', enum: ['activity', 'stay', 'travel'] },
  targetId: uuidSchema,
  providerName: text(160),
  reference: text(80),
  notes: text(2000),
}, ['targetType', 'targetId']);

export const contactProperties = object({
  role: { type: 'string', enum: ['organiser', 'hotel', 'driver', 'rental', 'activity_provider'] },
  name: text(160, 1),
  phone: text(40),
  note: text(500),
  stayId: nullable(uuidSchema),
  activityId: nullable(uuidSchema),
}, ['role', 'name']);

export const voteProperties = object({ interested: { type: 'boolean' } }, ['interested']);

export const commentProperties = object({ body: text(2000, 1) }, ['body']);

export const activityStatusProperties = object({
  status: { type: 'string', enum: ['planned', 'confirmed', 'cancelled'] },
}, ['status']);

export const attendeesProperties = object({
  participantIds: { type: 'array', items: uuidSchema, uniqueItems: true, maxItems: 50 },
}, ['participantIds']);

export const categoryLimitsProperties = object({
  limits: { type: 'array', maxItems: 6, items: object({
    category: { type: 'string', enum: ['accommodation', 'transport', 'food', 'activities', 'shopping', 'other'] },
    limitPaise: moneySchema,
  }, ['category', 'limitPaise']) },
}, ['limits']);

export const checklistProperties = object({
  visibility: { type: 'string', enum: ['personal', 'shared'] },
  title: text(200, 1),
  assigneeUserId: nullable(uuidSchema),
}, ['visibility', 'title']);

export const checklistPatchProperties = { ...object({
  title: text(200, 1),
  assigneeUserId: nullable(uuidSchema),
  completedAt: nullable({ type: 'string', minLength: 1 }),
}), minProperties: 1 };
