import test from "node:test";
import assert from "node:assert/strict";
import { overlaps, withBuffer } from "../src/domain/overlap.ts";

test("overlapping intervals return true", () => {
  assert.equal(overlaps(
    { start: new Date("2026-11-11T08:00:00Z"), end: new Date("2026-11-11T10:00:00Z") },
    { start: new Date("2026-11-11T09:00:00Z"), end: new Date("2026-11-11T11:00:00Z") }
  ), true);
});
test("adjacent half-open intervals do not overlap", () => {
  assert.equal(overlaps(
    { start: new Date("2026-11-11T08:00:00Z"), end: new Date("2026-11-11T09:00:00Z") },
    { start: new Date("2026-11-11T09:00:00Z"), end: new Date("2026-11-11T10:00:00Z") }
  ), false);
});
test("buffer extends interval", () => {
  const i = withBuffer({ start: new Date("2026-11-11T08:00:00Z"), end: new Date("2026-11-11T09:00:00Z") }, 15, 30);
  assert.equal(i.start.toISOString(), "2026-11-11T07:45:00.000Z");
  assert.equal(i.end.toISOString(), "2026-11-11T09:30:00.000Z");
});
