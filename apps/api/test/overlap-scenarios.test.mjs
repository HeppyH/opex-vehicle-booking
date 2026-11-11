import test from "node:test";
import assert from "node:assert/strict";
import { overlaps, withBuffer } from "../src/domain/overlap.ts";

// ---------------------------------------------------------------------------
// Pure interval-overlap scenarios. These tests do NOT require PostgreSQL and
// validate the conflict-prevention logic that the database GiST exclusion
// constraint and the assignment service rely upon.
// ---------------------------------------------------------------------------

test("two bookings for the same vehicle with overlapping windows conflict", () => {
  const existing = {
    start: new Date("2026-11-12T08:00:00Z"),
    end: new Date("2026-11-12T10:00:00Z")
  };
  const candidate = {
    start: new Date("2026-11-12T09:00:00Z"),
    end: new Date("2026-11-12T11:00:00Z")
  };
  assert.equal(overlaps(existing, candidate), true);
});

test("two bookings for the same vehicle with adjacent windows do not conflict", () => {
  const existing = {
    start: new Date("2026-11-12T08:00:00Z"),
    end: new Date("2026-11-12T10:00:00Z")
  };
  const candidate = {
    start: new Date("2026-11-12T10:00:00Z"),
    end: new Date("2026-11-12T12:00:00Z")
  };
  assert.equal(overlaps(existing, candidate), false);
});

test("a booking fully contained within an existing window conflicts", () => {
  const existing = {
    start: new Date("2026-11-12T08:00:00Z"),
    end: new Date("2026-11-12T12:00:00Z")
  };
  const candidate = {
    start: new Date("2026-11-12T09:00:00Z"),
    end: new Date("2026-11-12T10:00:00Z")
  };
  assert.equal(overlaps(existing, candidate), true);
});

test("a booking that fully covers an existing window conflicts", () => {
  const existing = {
    start: new Date("2026-11-12T09:00:00Z"),
    end: new Date("2026-11-12T10:00:00Z")
  };
  const candidate = {
    start: new Date("2026-11-12T08:00:00Z"),
    end: new Date("2026-11-12T12:00:00Z")
  };
  assert.equal(overlaps(existing, candidate), true);
});

test("identical windows conflict", () => {
  const a = { start: new Date("2026-11-12T08:00:00Z"), end: new Date("2026-11-12T10:00:00Z") };
  const b = { start: new Date("2026-11-12T08:00:00Z"), end: new Date("2026-11-12T10:00:00Z") };
  assert.equal(overlaps(a, b), true);
});

test("buffers extend the reserved interval before and after", () => {
  const base = {
    start: new Date("2026-11-12T08:00:00Z"),
    end: new Date("2026-11-12T10:00:00Z")
  };
  const buffered = withBuffer(base, 15, 30);
  assert.equal(buffered.start.toISOString(), "2026-11-12T07:45:00.000Z");
  assert.equal(buffered.end.toISOString(), "2026-11-12T10:30:00.000Z");
});

test("a candidate starting inside another booking's before-buffer conflicts", () => {
  const existing = {
    start: new Date("2026-11-12T08:00:00Z"),
    end: new Date("2026-11-12T10:00:00Z"),
    buffer_before_minutes: 15,
    buffer_after_minutes: 30
  };
  const bufferedExisting = withBuffer(
    existing,
    existing.buffer_before_minutes,
    existing.buffer_after_minutes
  );
  // Candidate starts at 07:50, which is inside the before-buffer (07:45-08:00).
  const candidate = {
    start: new Date("2026-11-12T07:50:00Z"),
    end: new Date("2026-11-12T08:10:00Z")
  };
  assert.equal(overlaps(bufferedExisting, candidate), true);
});

test("a candidate ending inside another booking's after-buffer conflicts", () => {
  const existing = {
    start: new Date("2026-11-12T08:00:00Z"),
    end: new Date("2026-11-12T10:00:00Z"),
    buffer_before_minutes: 15,
    buffer_after_minutes: 30
  };
  const bufferedExisting = withBuffer(
    existing,
    existing.buffer_before_minutes,
    existing.buffer_after_minutes
  );
  // Candidate ends at 10:20, inside the after-buffer (10:00-10:30).
  const candidate = {
    start: new Date("2026-11-12T10:05:00Z"),
    end: new Date("2026-11-12T10:20:00Z")
  };
  assert.equal(overlaps(bufferedExisting, candidate), true);
});

test("end must be after start; invalid interval throws", () => {
  assert.throws(() => overlaps(
    { start: new Date("2026-11-12T10:00:00Z"), end: new Date("2026-11-12T08:00:00Z") },
    { start: new Date("2026-11-12T09:00:00Z"), end: new Date("2026-11-12T11:00:00Z") }
  ), /End must be after start/);
});

test("zero-length interval (start === end) throws", () => {
  const same = new Date("2026-11-12T08:00:00Z");
  assert.throws(() => overlaps(
    { start: same, end: same },
    { start: same, end: new Date("2026-11-12T09:00:00Z") }
  ), /End must be after start/);
});

test("negative buffer throws", () => {
  assert.throws(() => withBuffer(
    { start: new Date("2026-11-12T08:00:00Z"), end: new Date("2026-11-12T09:00:00Z") },
    -5, 0
  ), /Buffer cannot be negative/);
});
