export type Interval = { start: Date; end: Date };
export function overlaps(a: Interval, b: Interval): boolean {
  if (!(a.start instanceof Date) || !(a.end instanceof Date) ||
      !(b.start instanceof Date) || !(b.end instanceof Date)) throw new Error("Invalid interval");
  if (a.end <= a.start || b.end <= b.start) throw new Error("End must be after start");
  // Half-open intervals [start, end): touching endpoints do not overlap.
  return a.start < b.end && b.start < a.end;
}
export function withBuffer(i: Interval, beforeMinutes = 0, afterMinutes = 0): Interval {
  if (beforeMinutes < 0 || afterMinutes < 0) throw new Error("Buffer cannot be negative");
  return {
    start: new Date(i.start.getTime() - beforeMinutes * 60_000),
    end: new Date(i.end.getTime() + afterMinutes * 60_000)
  };
}
