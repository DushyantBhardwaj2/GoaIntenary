import assert from "node:assert/strict";
import { test } from "node:test";
import type { api } from "./client";
import { createPlannerData } from "./planner-data";

test("five activity cards need no eager requests and share trip lists on demand", async () => {
  const paths: string[] = [];
  const read: typeof api = async <T>(path: string) => { paths.push(path); return (path.endsWith("/bookings") ? { bookings: [] } : { participants: [] }) as T; };
  const data = createPlannerData("trip-a", read);
  assert.equal(paths.length, 0);
  // Staggered opens share settled lists only inside the currently mounted planner.
  for (let card = 0; card < 5; card++) { await data.people(); await data.bookings(); }
  assert.equal(paths.length, 2);
  assert.ok(paths.every(path => path.includes("/trips/trip-a/")));
});

test("writes and access loss invalidate mounted planner lists, with no cross-trip reuse", async () => {
  let calls = 0;
  const read: typeof api = async <T>(path: string) => { calls++; return (path.endsWith("/bookings") ? { bookings: [] } : { participants: [] }) as T; };
  const first = createPlannerData("trip-a", read);
  await Promise.all([first.people(), first.people(), first.bookings(), first.bookings()]);
  assert.equal(calls, 2);
  first.invalidate("/api/core/v1/trips/trip-a/bookings/booking");
  await first.bookings();
  assert.equal(calls, 3);
  first.invalidate();
  await first.people();
  assert.equal(calls, 4);
  await createPlannerData("trip-b", read).people();
  assert.equal(calls, 5);
});

test("failed shared lists are retryable and invalidation cannot refill an old snapshot", async () => {
  let calls = 0;
  let resolve!: (value: { participants: [] }) => void;
  const pending = new Promise<{ participants: [] }>(done => { resolve = done; });
  const read: typeof api = async <T>() => { calls++; if (calls === 1) throw new Error("Forbidden"); return (calls === 2 ? await pending : { participants: [] }) as T; };
  const data = createPlannerData("trip", read);
  await assert.rejects(data.people(), /Forbidden/);
  const old = data.people();
  data.invalidate();
  await data.people();
  resolve({ participants: [] });
  await old;
  await data.people();
  assert.equal(calls, 3);
});
