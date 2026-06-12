import { describe, it, expect } from "vitest";
import { visibleToSnapshot, classifyTuple } from "./visibility";

describe("visibleToSnapshot", () => {
  it("a live tuple is visible iff its inserter precedes the snapshot xmin", () => {
    expect(visibleToSnapshot(99, 0, 100)).toBe(true);
    expect(visibleToSnapshot(100, 0, 100)).toBe(false); // inserted by/after snapshot boundary
    expect(visibleToSnapshot(101, 0, 100)).toBe(false);
  });

  it("a deleted tuple is visible iff the delete happened at or after the snapshot xmin", () => {
    // Snapshot at 100: a tuple deleted by xid 100+ was still current when the
    // snapshot was taken, so the snapshot must keep seeing it.
    expect(visibleToSnapshot(90, 100, 100)).toBe(true);
    expect(visibleToSnapshot(90, 150, 100)).toBe(true);
    expect(visibleToSnapshot(90, 99, 100)).toBe(false); // deleted before snapshot
  });

  it("a version created and superseded after the snapshot is invisible to it", () => {
    expect(visibleToSnapshot(105, 107, 100)).toBe(false);
  });
});

describe("classifyTuple", () => {
  it("xmax 0 is live regardless of horizon", () => {
    expect(classifyTuple(0, 100)).toBe("live");
    expect(classifyTuple(0, 1)).toBe("live");
  });

  it("dead is removable only strictly below the horizon", () => {
    expect(classifyTuple(99, 100)).toBe("dead-removable");
    expect(classifyTuple(100, 100)).toBe("dead-pinned"); // boundary: deleter == horizon
    expect(classifyTuple(150, 100)).toBe("dead-pinned");
  });

  it("keeps the invisible-to-everyone intermediate version (conservatism Postgres shares)", () => {
    // Snapshot/horizon at 100; version lived from 105 to 107. No snapshot can
    // see it, but its deleter is not below the horizon, so it is kept.
    expect(visibleToSnapshot(105, 107, 100)).toBe(false);
    expect(classifyTuple(107, 100)).toBe("dead-pinned");
  });
});
