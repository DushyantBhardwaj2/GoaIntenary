import { api, core, type ExpenseParticipant } from "./client";
import type { Booking } from "./trip-planning-types";

/** Lives only as long as one mounted planner, like the planner's activity state. */
export function createPlannerData(tripId: string, read: typeof api = api) {
  let generation = 0;
  let people: ExpenseParticipant[] | undefined;
  let bookings: Booking[] | undefined;
  let peopleRequest: Promise<ExpenseParticipant[]> | undefined;
  let bookingsRequest: Promise<Booking[]> | undefined;
  const base = `${core}/trips/${tripId}`;
  return {
    people(): Promise<ExpenseParticipant[]> {
      if (people) return Promise.resolve(people);
      if (peopleRequest) return peopleRequest;
      const current = generation;
      const pending = read<{ participants: ExpenseParticipant[] }>(`${base}/expense-participants`).then((data) => {
        if (generation === current) people = data.participants;
        return data.participants;
      });
      peopleRequest = pending;
      void pending.finally(() => { if (peopleRequest === pending) peopleRequest = undefined; }).catch(() => undefined);
      return pending;
    },
    bookings(): Promise<Booking[]> {
      if (bookings) return Promise.resolve(bookings);
      if (bookingsRequest) return bookingsRequest;
      const current = generation;
      const pending = read<{ bookings: Booking[] }>(`${base}/bookings`).then((data) => {
        if (generation === current) bookings = data.bookings;
        return data.bookings;
      });
      bookingsRequest = pending;
      void pending.finally(() => { if (bookingsRequest === pending) bookingsRequest = undefined; }).catch(() => undefined);
      return pending;
    },
    invalidate(path?: string) {
      if (path && !path.startsWith(`${base}/bookings`) && !path.startsWith(`${base}/expense-participants`) && !path.startsWith(`${base}/members`)) return;
      generation += 1;
      people = undefined;
      bookings = undefined;
      peopleRequest = undefined;
      bookingsRequest = undefined;
    },
  };
}

export type PlannerData = ReturnType<typeof createPlannerData>;
