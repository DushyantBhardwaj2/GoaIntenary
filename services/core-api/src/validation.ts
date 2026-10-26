import { uuidPattern } from './auth.js';
import type { FastifyRequest } from 'fastify';
import { invalid } from './errors.js';
import type { ActivityInput, CreateTrip, SavedPlaceInput } from './types.js';

export const MAX_PAISE = 1_000_000_000;
export const activityCategories = ['beach', 'food', 'cafe', 'nightlife', 'culture', 'adventure', 'shopping', 'transport', 'other'] as const;
export const expenseCategories = ['accommodation', 'transport', 'food', 'activities', 'shopping', 'other'] as const;
export const regions = ['north', 'south', 'central', 'all'] as const;
export const tripStyles = ['beaches', 'nightlife', 'food', 'culture', 'adventure', 'relaxation'] as const;
export const uuidSchema = { type: 'string', pattern: uuidPattern.source };
export const dateSchema = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
export const moneySchema = { type: 'integer', minimum: 0, maximum: MAX_PAISE };
export const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
export const text = (maxLength: number, minLength = 0) => ({ type: 'string', minLength, maxLength });
export const placeIdSchema = { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' };
export const params = (names: string[]) => ({ type: 'object', additionalProperties: false, required: names,
  properties: Object.fromEntries(names.map((name) => [name, name === 'placeId' ? placeIdSchema : uuidSchema])) });
export const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, required });
export const tripProperties = {
  name: text(100, 1), startDate: dateSchema, endDate: dateSchema, description: text(2000),
  region: { type: 'string', enum: regions }, travellerCount: { type: 'integer', minimum: 1, maximum: 50 },
  budgetPaise: nullable(moneySchema), styles: { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'string', enum: tripStyles } },
};
export const activityProperties = {
  title: text(160, 1), description: text(2000), location: text(200), category: { type: 'string', enum: activityCategories },
  day: nullable(dateSchema), startTime: nullable({ type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }),
  endTime: nullable({ type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' }), estimatedCostPaise: moneySchema,
  notes: text(4000), meetingPoint: text(200), placeId: nullable(placeIdSchema),
  latitude: nullable({ type: 'number', minimum: -90, maximum: 90 }), longitude: nullable({ type: 'number', minimum: -180, maximum: 180 }),
};
export const savedPlaceProperties = {
  placeId: placeIdSchema, title: text(160, 1), category: { type: 'string', enum: activityCategories },
  region: { type: 'string', enum: ['north', 'south', 'central'] }, latitude: { type: 'number', minimum: -90, maximum: 90 },
  longitude: { type: 'number', minimum: -180, maximum: 180 }, sourceUrl: text(2048, 1),
};
export const splitSchema = { oneOf: [
  object({ mode: { const: 'none' } },['mode']),
  object({ mode: { const: 'equal' },participantIds: { type: 'array',minItems: 1,maxItems: 50,uniqueItems: true,items: uuidSchema } },['mode','participantIds']),
  object({ mode: { const: 'custom' },shares: { type: 'array',minItems: 1,maxItems: 50,items: object({ participantId: uuidSchema,amountPaise: moneySchema },['participantId','amountPaise']) } },['mode','shares']),
] };
export const expenseProperties = { title: text(160, 1), amountPaise: { ...moneySchema, minimum: 1 },
  category: { type: 'string', enum: expenseCategories }, date: dateSchema, paidByUserId: uuidSchema,
  paidByParticipantId: uuidSchema,split: splitSchema,acknowledgeSettlementChange: { type: 'boolean' } };
export const versionSchema = { type: 'integer', minimum: 1, maximum: 2_147_483_646 };

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
export function validateTrip(input: CreateTrip): void {
  if (!input.name.trim() || !isCalendarDate(input.startDate) || !isCalendarDate(input.endDate) || input.startDate > input.endDate ||
    (Date.parse(`${input.endDate}T00:00:00Z`) - Date.parse(`${input.startDate}T00:00:00Z`)) / 86_400_000 > 366) {
    throw invalid('Use a trip name and real dates no more than 366 days apart.');
  }
}
export function validateActivity(input: ActivityInput, trip: { startDate: string; endDate: string }): void {
  if (!input.title.trim()) throw invalid('Give the activity a title.');
  if (input.day !== null && (!isCalendarDate(input.day) || input.day < trip.startDate || input.day > trip.endDate)) throw invalid('Choose a day within this trip.');
  if (input.endTime !== null && (input.startTime === null || input.endTime <= input.startTime)) throw invalid('End time must follow start time.');
  if ((input.latitude === null) !== (input.longitude === null)) throw invalid('Supply both coordinates or leave both empty.');
}
export function validateSavedPlace(input: SavedPlaceInput): void {
  if (!input.title.trim()) throw invalid('Give the saved place a title.');
  try {
    const url = new URL(input.sourceUrl);
    if (!/^https?:\/\//i.test(input.sourceUrl) || /[\u0000-\u0020\u007f]/.test(input.sourceUrl) || !url.hostname ||
      !['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
  }
  catch { throw invalid('Use an HTTP or HTTPS source URL.'); }
}
export function noBody(request: FastifyRequest): void {
  if (request.body !== undefined && (request.body === null || typeof request.body !== 'object' || Array.isArray(request.body) || Object.keys(request.body).length)) throw invalid();
}
export function retryKey(request: FastifyRequest): string | undefined {
  const key = request.headers['idempotency-key'];
  if (key !== undefined && (typeof key !== 'string' || !uuidPattern.test(key))) throw invalid('Use a valid retry key.');
  return key?.toLowerCase();
}
