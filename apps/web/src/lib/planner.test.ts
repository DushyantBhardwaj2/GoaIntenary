import { test } from "node:test";
import assert from "node:assert/strict";
import { parseINR, money } from "./money";
import { tripDays, overlappingIds } from "./planner";
test("INR input converts decimal text exactly and rejects malformed values", () => {
  assert.equal(parseINR("1250.50"), 125050); assert.equal(parseINR("0.01"), 1); assert.equal(parseINR("20000"), 2000000);
  for (const value of ["1,250", "₹20", "1e3", "-1", "1.001", "01", ".50", "10000000.01"]) assert.throws(() => parseINR(value));
  assert.throws(() => parseINR("0", false)); assert.equal(money(125050), "₹1,250.50");
});
test("days include leap day and both boundaries; overlaps only warn about actual intersecting ranges", () => {
  assert.deepEqual(tripDays("2028-02-28", "2028-03-01"), ["2028-02-28", "2028-02-29", "2028-03-01"]);
  const base = { day: "2026-11-01" };
  assert.deepEqual([...overlappingIds([{ ...base, id: "a", startTime: "09:00", endTime: "10:00" }, { ...base, id: "b", startTime: "09:30", endTime: "11:00" }, { ...base, id: "c", startTime: "11:00", endTime: "12:00" }])], ["a", "b"]);
});
