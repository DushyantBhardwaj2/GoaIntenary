import type { FastifyInstance, FastifyRequest } from 'fastify';
import { BookingRepository, type BookingWrite } from './booking-repository.js';
import type { TripRepository } from './repository.js';
import { bookingProperties } from './trip-planning-validation.js';
import { noBody, params, retryKey } from './validation.js';

type TripParams = { tripId: string };
type BookingParams = TripParams & { bookingId: string };
const actor = (request: FastifyRequest) => request.user!.id;

export function registerBookingRoutes(app: FastifyInstance, core: TripRepository): void {
  const bookings = new BookingRepository(core);
  const limit = (request: FastifyRequest) => core.rateLimit('booking-write', actor(request), 100);

  app.get<{ Params: TripParams }>('/v1/trips/:tripId/bookings', { schema: { params: params(['tripId']) } },
    async (request) => ({ bookings: await bookings.listBookings(actor(request), request.params.tripId) }));

  app.post<{ Params: TripParams; Body: BookingWrite }>('/v1/trips/:tripId/bookings', {
    schema: { params: params(['tripId']), body: bookingProperties },
  }, async (request, reply) => {
    const key = retryKey(request);
    await limit(request);
    return reply.status(201).send({ booking: await bookings.createBooking(actor(request), request.params.tripId, request.body, key) });
  });

  app.patch<{ Params: BookingParams; Body: BookingWrite }>('/v1/trips/:tripId/bookings/:bookingId', {
    schema: { params: params(['tripId', 'bookingId']), body: bookingProperties },
  }, async (request) => {
    await limit(request);
    return { booking: await bookings.updateBooking(actor(request), request.params.tripId, request.params.bookingId, request.body) };
  });

  app.delete<{ Params: BookingParams }>('/v1/trips/:tripId/bookings/:bookingId', {
    schema: { params: params(['tripId', 'bookingId']) }, preValidation: async (request) => noBody(request),
  }, async (request, reply) => {
    await limit(request);
    await bookings.deleteBooking(actor(request), request.params.tripId, request.params.bookingId);
    return reply.status(204).send();
  });
}
