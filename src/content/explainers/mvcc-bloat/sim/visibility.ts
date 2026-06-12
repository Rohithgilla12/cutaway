// The two predicates the whole explainer rests on. Both assume the sim's
// commit model: every writing transaction commits the instant it is assigned
// an xid, so "xid < snapshotXmin" doubles as "committed before the snapshot".
// Real Postgres also consults commit status (CLOG) and the snapshot's
// in-progress list; see SIMPLIFICATIONS in mvccSim.ts.

// A tuple version is visible to a snapshot when its inserter committed before
// the snapshot was taken AND its deleter (if any) had not.
export function visibleToSnapshot(xmin: number, xmax: number, snapshotXmin: number): boolean {
  return xmin < snapshotXmin && (xmax === 0 || xmax >= snapshotXmin);
}

export type TupleFate = "live" | "dead-removable" | "dead-pinned";

// Vacuum's rule is deliberately cruder than visibility: a dead tuple is
// removable iff its deleting xid precedes the oldest xmin any backend still
// holds. A version deleted AFTER the horizon is kept even when no snapshot
// can see it (created and superseded both after the snapshot) — Postgres
// keeps intermediate versions conservatively rather than proving them
// invisible to every snapshot individually.
export function classifyTuple(xmax: number, horizonXid: number): TupleFate {
  if (xmax === 0) return "live";
  return xmax < horizonXid ? "dead-removable" : "dead-pinned";
}
