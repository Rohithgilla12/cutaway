import { describe, it, expect } from "vitest";
import {
  createLsmSim,
  SIMPLIFICATIONS,
  KEY_COUNT,
  L0_COMPACTION_THRESHOLD,
  L1_MAX_FILES,
  MEMTABLE_FLUSH_THRESHOLD,
  type LsmSim,
  type LsmSnapshot,
} from "./lsmSim";

function keyName(i: number): string {
  return `k${i.toString().padStart(2, "0")}`;
}

// Deterministic test RNG (independent of the sim's RNG and of Math.random).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Independent oracle: a plain Map that applies the SAME user writes/deletes in
// order. get(k) on the sim must agree with this for every key, at every point.
// The oracle models the USER-VISIBLE contract: a deleted key reads as "absent"
// (the tombstone is an internal mechanism, surfaced only in the probe trace).
type OracleState = "value" | "absent";
class Oracle {
  private m = new Map<string, number>();
  write(key: string, value: number): void {
    this.m.set(key, value);
  }
  del(key: string): void {
    this.m.delete(key);
  }
  read(key: string): { state: OracleState; value: number | null } {
    const v = this.m.get(key);
    if (v === undefined) return { state: "absent", value: null };
    return { state: "value", value: v };
  }
}

function assertSimEqualsOracle(sim: LsmSim, oracle: Oracle): void {
  for (let i = 0; i < KEY_COUNT; i++) {
    const key = keyName(i);
    const path = sim.get(key);
    const exp = oracle.read(key);
    expect(path.outcome, `key ${key} outcome`).toBe(exp.state);
    expect(path.value, `key ${key} value`).toBe(exp.value);
    // readAmp definitionally equals probe count.
    expect(path.readAmplification).toBe(path.probes.length);
  }
}

type Op =
  | { t: "write"; key: string; value: number }
  | { t: "delete"; key: string }
  | { t: "flush" }
  | { t: "compact" }
  | { t: "get"; key: string };

function makeSchedule(seed: number, n: number, opts: { autoFlush?: boolean; autoCompact?: boolean } = {}): Op[] {
  const r = lcg(seed);
  const ops: Op[] = [];
  for (let i = 0; i < n; i++) {
    const x = r();
    const key = keyName(Math.floor(r() * KEY_COUNT));
    if (x < 0.5) ops.push({ t: "write", key, value: 1 + Math.floor(r() * 99) });
    else if (x < 0.66) ops.push({ t: "delete", key });
    else if (x < 0.78 && !opts.autoFlush) ops.push({ t: "flush" });
    else if (x < 0.9 && !opts.autoCompact) ops.push({ t: "compact" });
    else ops.push({ t: "get", key });
  }
  return ops;
}

function applyOp(sim: LsmSim, oracle: Oracle, op: Op): void {
  switch (op.t) {
    case "write":
      sim.write(op.key, op.value);
      oracle.write(op.key, op.value);
      break;
    case "delete":
      sim.delete(op.key);
      oracle.del(op.key);
      break;
    case "flush":
      sim.flush();
      break;
    case "compact":
      sim.compact();
      break;
    case "get":
      sim.get(op.key);
      break;
  }
}

// ---------------------------------------------------------------------------
// 1. Read correctness — the big one.
// ---------------------------------------------------------------------------
describe("read correctness (oracle sweep)", () => {
  it("get(k) for every key matches an independent oracle at every schedule point", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const sim = createLsmSim(seed);
      const oracle = new Oracle();
      const ops = makeSchedule(seed, 70);
      for (const op of ops) {
        applyOp(sim, oracle, op);
        assertSimEqualsOracle(sim, oracle);
      }
    }
  });

  it("deleted keys read as absent both before and after tombstone-dropping compaction", () => {
    const sim = createLsmSim(123);
    const oracle = new Oracle();
    // Write some keys, flush, compact down to L1.
    for (let i = 0; i < 6; i++) {
      sim.write(keyName(i), 10 + i);
      oracle.write(keyName(i), 10 + i);
    }
    sim.flush();
    sim.compact(); // keys now in L1 (bottommost)
    // Delete one, flush so the tombstone is in L0, then verify absent.
    sim.delete(keyName(3));
    oracle.del(keyName(3));
    sim.flush(); // tombstone now an L0 SSTable
    expect(sim.get(keyName(3)).outcome).toBe("absent");
    // Compact: tombstone meets its target in L1 and is dropped.
    sim.compact();
    const after = sim.snapshot();
    // The key is genuinely gone from every structure (no tombstone left for it).
    for (const t of [...after.l0, ...after.l1]) {
      expect(t.keys).not.toContain(keyName(3));
    }
    expect(sim.get(keyName(3)).outcome).toBe("absent");
    assertSimEqualsOracle(sim, oracle);
  });

  it("matches oracle under auto-flush + auto-compact churn", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const sim = createLsmSim(seed);
      sim.setAutoFlush(true);
      sim.setAutoCompact(true);
      const oracle = new Oracle();
      const ops = makeSchedule(seed * 3, 80, {
        autoFlush: true,
        autoCompact: true,
      });
      for (const op of ops) {
        applyOp(sim, oracle, op);
        assertSimEqualsOracle(sim, oracle);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Version ordering — newest-first probing, never a stale version.
// ---------------------------------------------------------------------------
describe("version ordering", () => {
  it("a read returns the newest version and probes newest-first", () => {
    const sim = createLsmSim(5);
    sim.write("k05", 1);
    sim.flush(); // L0 table A (oldest)
    sim.write("k05", 2);
    sim.flush(); // L0 table B (newer)
    sim.write("k05", 3); // memtable (newest)
    const path = sim.get("k05");
    expect(path.outcome).toBe("value");
    expect(path.value).toBe(3); // newest wins
    // First probe is the memtable and it hits — no stale L0 read happens.
    expect(path.probes[0].structure).toBe("memtable");
    expect(path.probes[0].hit).toBe(true);
    expect(path.readAmplification).toBe(1);
  });

  it("L0 probes run strictly newest seq -> oldest seq", () => {
    const sim = createLsmSim(9);
    // Three L0 tables all containing k10 with increasing values.
    sim.write("k10", 1);
    sim.flush();
    sim.write("k10", 2);
    sim.flush();
    sim.write("k10", 3);
    sim.flush();
    const snap = sim.snapshot();
    // snapshot l0 is newest-first; assert seq descending.
    for (let i = 1; i < snap.l0.length; i++) {
      expect(snap.l0[i - 1].seq).toBeGreaterThan(snap.l0[i].seq);
    }
    const path = sim.get("k10");
    expect(path.value).toBe(3); // newest L0 wins
    // It hit on the first L0 probe (after the memtable miss): 2 probes total.
    expect(path.probes[0].structure).toBe("memtable");
    expect(path.probes[1].structure).toBe("L0");
    expect(path.probes[1].hit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. L1 disjointness — non-overlapping and sorted after every compaction.
// ---------------------------------------------------------------------------
describe("L1 disjointness", () => {
  function assertL1Disjoint(snap: LsmSnapshot): void {
    const l1 = snap.l1;
    for (let i = 1; i < l1.length; i++) {
      const prev = l1[i - 1];
      const cur = l1[i];
      if (prev.maxKey === null || cur.minKey === null) continue;
      // sorted ascending and strictly non-overlapping (prev.max < cur.min)
      expect(prev.maxKey < cur.minKey).toBe(true);
    }
  }

  it("after every compaction L1 ranges are sorted and non-overlapping", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const sim = createLsmSim(seed);
      const oracle = new Oracle();
      const ops = makeSchedule(seed, 80);
      for (const op of ops) {
        applyOp(sim, oracle, op);
        if (op.t === "compact") {
          assertL1Disjoint(sim.snapshot());
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Tombstone lifecycle.
// ---------------------------------------------------------------------------
describe("tombstone lifecycle", () => {
  it("tombstone survives flush and L0, drops exactly at bottommost compaction", () => {
    const sim = createLsmSim(1);
    sim.write("k07", 42);
    sim.flush();
    sim.compact(); // k07 -> L1
    expect(sim.get("k07").value).toBe(42);

    sim.delete("k07");
    // Tombstone in memtable.
    expect(sim.snapshot().tombstoneCount).toBeGreaterThanOrEqual(1);
    expect(sim.get("k07").outcome).toBe("absent");

    sim.flush(); // tombstone now in L0
    const afterFlush = sim.snapshot();
    expect(afterFlush.tombstoneCount).toBeGreaterThanOrEqual(1);
    const l0HasTomb = afterFlush.l0.some((t) => t.tombstoneCount > 0);
    expect(l0HasTomb).toBe(true);
    expect(sim.get("k07").outcome).toBe("absent");

    sim.compact(); // bottommost-level compaction drops the tombstone
    const afterCompact = sim.snapshot();
    expect(afterCompact.tombstoneCount).toBe(0);
    // k07 gone from every structure.
    for (const t of [...afterCompact.l0, ...afterCompact.l1]) {
      expect(t.keys).not.toContain("k07");
    }
    expect(sim.get("k07").outcome).toBe("absent");
  });

  it("eventLog reports dropped tombstones at compaction", () => {
    const sim = createLsmSim(2);
    sim.write("k01", 5);
    sim.flush();
    sim.compact();
    sim.delete("k01");
    sim.flush();
    sim.compact();
    const log = sim.snapshot().eventLog;
    expect(log.some((l) => /dropped \d+ tombstones/.test(l))).toBe(true);
    expect(log.some((l) => /dropped [1-9]\d* tombstones/.test(l))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Amplification math.
// ---------------------------------------------------------------------------
describe("amplification math", () => {
  it("readAmp equals probes in lastReadPath", () => {
    const sim = createLsmSim(4);
    const oracle = new Oracle();
    const ops = makeSchedule(4, 60);
    for (const op of ops) applyOp(sim, oracle, op);
    for (let i = 0; i < KEY_COUNT; i++) {
      const path = sim.get(keyName(i));
      const snap = sim.snapshot();
      expect(snap.readAmplificationLast).toBe(path.probes.length);
      expect(snap.lastReadPath!.readAmplification).toBe(path.probes.length);
    }
  });

  it("read amplification climbs as un-compacted L0 piles up", () => {
    const sim = createLsmSim(6);
    // Put the same key in many L0 tables, never compact. The worst-case read for a
    // missing/absent key probes the memtable + every L0 table.
    sim.write("k15", 1);
    sim.flush();
    const ampAfter1 = sim.get("k31").readAmplification; // absent key: full scan
    for (let i = 0; i < 5; i++) {
      sim.write("k15", i + 2);
      sim.flush();
    }
    const ampAfter6 = sim.get("k31").readAmplification;
    expect(ampAfter6).toBeGreaterThan(ampAfter1);
  });

  it("writeAmp increases after compaction and never decreases", () => {
    const sim = createLsmSim(8);
    let prev = sim.snapshot().writeAmplification;
    const checkMonotone = (): void => {
      const cur = sim.snapshot().writeAmplification;
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = cur;
    };
    for (let i = 0; i < 8; i++) {
      sim.write(keyName(i), i);
      checkMonotone();
    }
    sim.flush();
    checkMonotone();
    const beforeCompact = sim.snapshot().writeAmplification;
    sim.compact(); // rewrites bytes into L1
    const afterCompact = sim.snapshot().writeAmplification;
    expect(afterCompact).toBeGreaterThan(beforeCompact);
  });

  it("spaceAmp decreases after compacting away obsolete versions", () => {
    const sim = createLsmSim(10);
    // Write the SAME small set of keys repeatedly across many flushes so L0 holds
    // many obsolete versions of each key.
    for (let round = 0; round < 4; round++) {
      for (let k = 0; k < 3; k++) sim.write(keyName(k), round * 10 + k);
      sim.flush();
    }
    const before = sim.snapshot().spaceAmplification;
    expect(before).toBeGreaterThan(1); // duplicates inflate on-disk bytes
    sim.compact(); // collapses to one version per key
    const after = sim.snapshot().spaceAmplification;
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(1, 5); // exactly the live unique keys remain
  });
});

// ---------------------------------------------------------------------------
// 6. No data loss across arbitrary flush/compact sequences.
// ---------------------------------------------------------------------------
describe("no data loss", () => {
  it("every live write stays readable through arbitrary flush/compact churn", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const sim = createLsmSim(seed);
      const oracle = new Oracle();
      // Phase 1: writes only (no deletes) so every key is live.
      const r = lcg(seed * 11 + 3);
      for (let i = 0; i < 40; i++) {
        const key = keyName(Math.floor(r() * KEY_COUNT));
        const v = 1 + Math.floor(r() * 99);
        sim.write(key, v);
        oracle.write(key, v);
        // Sprinkle flush/compact.
        const y = r();
        if (y < 0.3) sim.flush();
        else if (y < 0.45) sim.compact();
      }
      // Final drain: flush + compact, then every live key must read back.
      sim.flush();
      sim.compact();
      assertSimEqualsOracle(sim, oracle);
    }
  });

  it("targeted churn: a single key survives a long flush/compact storm", () => {
    const sim = createLsmSim(77);
    sim.write("k20", 555);
    for (let i = 0; i < 20; i++) {
      // Write noise to OTHER keys, interleaved with flush/compact.
      sim.write(keyName(i % 15), i);
      if (i % 3 === 0) sim.flush();
      if (i % 5 === 0) sim.compact();
    }
    sim.flush();
    sim.compact();
    expect(sim.get("k20").value).toBe(555);
  });
});

// ---------------------------------------------------------------------------
// 7. Determinism + spam safety.
// ---------------------------------------------------------------------------
describe("determinism", () => {
  it("same seed + identical call sequence => JSON-equal snapshots at every step", () => {
    const seed = 99;
    const ops = makeSchedule(seed, 100);
    const a = createLsmSim(seed);
    const b = createLsmSim(seed);
    const oa = new Oracle();
    const ob = new Oracle();
    for (const op of ops) {
      applyOp(a, oa, op);
      applyOp(b, ob, op);
      expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    }
  });

  it("reset returns to a deterministic initial state for the same seed", () => {
    const a = createLsmSim(42);
    const fresh = JSON.stringify(a.snapshot());
    a.setAutoWrite(true);
    for (let i = 0; i < 10; i++) a.step(100);
    a.flush();
    a.compact();
    a.get();
    a.reset();
    expect(JSON.stringify(a.snapshot())).toBe(fresh);
  });

  it("reset re-seeds RNG: post-reset trajectory matches a fresh same-seed sim step-for-step", () => {
    // Exercise the sim heavily (consume RNG state), then reset. The reset sim must
    // reproduce the exact same sequence of RNG-driven outcomes (random keys, values)
    // as a freshly constructed same-seed sim when both are driven through identical ops.
    const SEED = 61;
    const exerciseOps = makeSchedule(SEED, 50);
    const postResetOps = makeSchedule(SEED * 3 + 1, 30);

    // Build up and then reset a sim.
    const resetSim = createLsmSim(SEED);
    const resetOracle = new Oracle();
    for (const op of exerciseOps) applyOp(resetSim, resetOracle, op);
    resetSim.flush();
    resetSim.compact();
    resetSim.reset();

    // Fresh sim with the same seed.
    const freshSim = createLsmSim(SEED);

    // Both must start from the same state.
    expect(JSON.stringify(resetSim.snapshot())).toBe(JSON.stringify(freshSim.snapshot()));

    // Drive both through an identical post-reset sequence and assert JSON-equal at every step.
    const freshOracle = new Oracle();
    const resetOracle2 = new Oracle();
    for (const op of postResetOps) {
      applyOp(resetSim, resetOracle2, op);
      applyOp(freshSim, freshOracle, op);
      expect(JSON.stringify(resetSim.snapshot())).toBe(JSON.stringify(freshSim.snapshot()));
    }
  });

  it("auto-write produces identical streams for the same seed", () => {
    const a = createLsmSim(31);
    const b = createLsmSim(31);
    a.setAutoWrite(true);
    b.setAutoWrite(true);
    for (let i = 0; i < 50; i++) {
      a.step(70);
      b.step(70);
    }
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
  });
});

describe("spam safety", () => {
  it("compact with empty L0, flush empty memtable, get during anything — no throws", () => {
    const sim = createLsmSim(13);
    expect(() => sim.compact()).not.toThrow(); // empty L0
    expect(() => sim.flush()).not.toThrow(); // empty memtable
    expect(() => sim.get()).not.toThrow(); // empty tree
    expect(() => sim.get("k00")).not.toThrow();
    const empty = sim.snapshot();
    expect(empty.l0FileCount).toBe(0);
    expect(empty.l1FileCount).toBe(0);
    // An empty-tree read still probes the memtable (a miss): readAmp == 1.
    expect(empty.readAmplificationLast).toBe(1);
    expect(empty.lastReadPath!.outcome).toBe("absent");
  });

  it("hammering every method in any order never throws or corrupts invariants", () => {
    const sim = createLsmSim(21);
    const r = lcg(7);
    for (let i = 0; i < 2000; i++) {
      const x = r();
      if (x < 0.25) sim.write(keyName(Math.floor(r() * KEY_COUNT)), Math.floor(r() * 99));
      else if (x < 0.4) sim.delete(keyName(Math.floor(r() * KEY_COUNT)));
      else if (x < 0.5) sim.writeRandom();
      else if (x < 0.58) sim.deleteRandom();
      else if (x < 0.72) sim.flush();
      else if (x < 0.85) sim.compact();
      else if (x < 0.93) sim.get();
      else sim.step(50 + Math.floor(r() * 200));

      const s = sim.snapshot();
      // Structural invariants that must hold always.
      expect(s.memtable.length).toBeLessThanOrEqual(KEY_COUNT);
      // L1 always non-overlapping + sorted.
      for (let j = 1; j < s.l1.length; j++) {
        const prev = s.l1[j - 1];
        const cur = s.l1[j];
        if (prev.maxKey !== null && cur.minKey !== null) {
          expect(prev.maxKey < cur.minKey).toBe(true);
        }
      }
      expect(s.l1.length).toBeLessThanOrEqual(L1_MAX_FILES);
      expect(s.writeAmplification).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(s.spaceAmplification).toBeGreaterThanOrEqual(1 - 1e-9);
      if (s.lastReadPath) {
        expect(s.lastReadPath.readAmplification).toBe(s.lastReadPath.probes.length);
      }
    }
  });

  it("auto modes can be toggled mid-stream without corruption", () => {
    const sim = createLsmSim(55);
    const oracle = new Oracle();
    sim.setAutoFlush(true);
    for (let i = 0; i < 10; i++) {
      sim.write(keyName(i), i);
      oracle.write(keyName(i), i);
    }
    sim.setAutoCompact(true);
    for (let i = 10; i < 20; i++) {
      sim.write(keyName(i), i);
      oracle.write(keyName(i), i);
    }
    sim.setAutoFlush(false);
    sim.setAutoCompact(false);
    assertSimEqualsOracle(sim, oracle);
  });
});

// ---------------------------------------------------------------------------
// Constants + metadata sanity.
// ---------------------------------------------------------------------------
describe("model constants and metadata", () => {
  it("exposes the documented thresholds", () => {
    expect(MEMTABLE_FLUSH_THRESHOLD).toBe(8);
    expect(L0_COMPACTION_THRESHOLD).toBe(4);
    expect(KEY_COUNT).toBe(32);
  });

  it("auto-flush fires exactly at the memtable threshold", () => {
    const sim = createLsmSim(3);
    sim.setAutoFlush(true);
    for (let i = 0; i < MEMTABLE_FLUSH_THRESHOLD - 1; i++) {
      sim.write(keyName(i), i);
    }
    expect(sim.snapshot().l0FileCount).toBe(0); // not yet
    sim.write(keyName(MEMTABLE_FLUSH_THRESHOLD - 1), 99);
    expect(sim.snapshot().l0FileCount).toBe(1); // flushed
    expect(sim.snapshot().memtable.length).toBe(0);
  });

  it("compaction pressure flag tracks the L0 threshold", () => {
    const sim = createLsmSim(3);
    for (let f = 0; f < L0_COMPACTION_THRESHOLD; f++) {
      sim.write(keyName(f), f);
      sim.flush();
    }
    expect(sim.snapshot().compactionPressure).toBe(true);
    expect(sim.snapshot().l0FileCount).toBe(L0_COMPACTION_THRESHOLD);
  });

  it("exports a non-empty SIMPLIFICATIONS list mentioning WAL and bloom filters", () => {
    expect(Array.isArray(SIMPLIFICATIONS)).toBe(true);
    expect(SIMPLIFICATIONS.length).toBeGreaterThan(3);
    expect(SIMPLIFICATIONS.every((s) => typeof s === "string" && s.length > 0)).toBe(true);
    expect(SIMPLIFICATIONS.some((s) => /WAL/i.test(s))).toBe(true);
    expect(SIMPLIFICATIONS.some((s) => /bloom/i.test(s))).toBe(true);
  });
});
