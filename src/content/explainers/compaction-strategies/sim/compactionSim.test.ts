import { describe, it, expect } from "vitest";
import {
  createCompactionSim,
  KEY_COUNT,
  MERGE_TRIGGER_RUNS,
  STOP_TRIGGER_RUNS,
  MAX_LEVEL,
  LEVEL_TARGETS,
  DISK_BUDGET_PER_SEC,
  SIMPLIFICATIONS,
  type CompactionSim,
  type CompactionSnapshot,
  type Strategy,
} from "./compactionSim";

function keyName(i: number): string {
  return `k${i.toString().padStart(2, "0")}`;
}

// Deterministic test RNG, independent of the sim's RNG.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function quiet(strategy: Strategy, seed = 1): CompactionSim {
  const sim = createCompactionSim(seed, { strategy, ingestRate: 0 });
  sim.setAutoRead(false);
  return sim;
}

function settle(sim: CompactionSim, ms = 60_000): void {
  // With ingest 0, this lets flushes and compactions run to completion.
  for (let t = 0; t < ms / 100; t++) sim.step(100);
}

// ---------------------------------------------------------------------------
// 1. Read correctness — the big one. Manual writes against a Map oracle, with
//    time advancing so flushes and compactions interleave, under both
//    strategies and across mid-run strategy switches.
// ---------------------------------------------------------------------------
describe("read correctness (oracle sweep)", () => {
  it("read(k) matches an independent oracle at every point, both strategies", () => {
    for (const strategy of ["leveled", "tiered"] as const) {
      for (let seed = 1; seed <= 12; seed++) {
        const sim = quiet(strategy, seed);
        const oracle = new Map<string, number>();
        const r = lcg(seed * 7 + 1);
        for (let i = 0; i < 120; i++) {
          const key = keyName(Math.floor(r() * KEY_COUNT));
          const value = 1 + Math.floor(r() * 999);
          sim.write(key, value);
          oracle.set(key, value);
          sim.step(Math.floor(r() * 400)); // lets flush/compaction land mid-schedule
          // Spot-probe every op; full keyspace sweep every tenth op.
          const probeKeys =
            i % 10 === 9
              ? Array.from({ length: KEY_COUNT }, (_, k) => keyName(k))
              : [keyName(Math.floor(r() * KEY_COUNT))];
          for (const pk of probeKeys) {
            const path = sim.read(pk);
            const exp = oracle.get(pk);
            expect(path.found, `${strategy} seed ${seed} key ${pk} op ${i}`).toBe(exp !== undefined);
            expect(path.value).toBe(exp ?? null);
            expect(path.readAmplification).toBe(path.probes.length);
          }
        }
      }
    }
  }, 20_000);

  it("reads stay correct across strategy switches mid-run", () => {
    const sim = quiet("leveled", 3);
    const oracle = new Map<string, number>();
    const r = lcg(99);
    for (let i = 0; i < 200; i++) {
      const key = keyName(Math.floor(r() * KEY_COUNT));
      const value = 1 + Math.floor(r() * 999);
      sim.write(key, value);
      oracle.set(key, value);
      if (i % 37 === 0) sim.setStrategy(i % 74 === 0 ? "tiered" : "leveled");
      if (i % 53 === 0) sim.fullCompaction();
      sim.step(Math.floor(r() * 300));
      const probe = keyName(Math.floor(r() * KEY_COUNT));
      const path = sim.read(probe);
      expect(path.value).toBe(oracle.get(probe) ?? null);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Structural invariants per strategy.
// ---------------------------------------------------------------------------
describe("structure", () => {
  it("leveled at rest holds at most one run per level above L0", () => {
    const sim = createCompactionSim(11, { strategy: "leveled", ingestRate: 8 });
    sim.setAutoRead(false);
    for (let t = 0; t < 600; t++) sim.step(100);
    sim.setIngestRate(0);
    settle(sim);
    const snap = sim.snapshot();
    expect(snap.job).toBeNull();
    for (let i = 1; i <= MAX_LEVEL; i++) {
      expect(snap.levels[i].length, `L${i} run count`).toBeLessThanOrEqual(1);
    }
    // And no level above L0 exceeds its target once settled.
    for (let i = 1; i < MAX_LEVEL; i++) {
      const size = snap.levels[i].reduce((s, r) => s + r.size, 0);
      expect(size).toBeLessThanOrEqual(LEVEL_TARGETS[i]);
    }
  });

  it("tiered at rest holds fewer than the merge trigger per tier", () => {
    const sim = createCompactionSim(12, { strategy: "tiered", ingestRate: 8 });
    sim.setAutoRead(false);
    for (let t = 0; t < 600; t++) sim.step(100);
    sim.setIngestRate(0);
    settle(sim);
    const snap = sim.snapshot();
    expect(snap.job).toBeNull();
    for (let i = 0; i <= MAX_LEVEL; i++) {
      expect(snap.levels[i].length, `tier ${i} run count`).toBeLessThan(MERGE_TRIGGER_RUNS);
    }
  });

  it("at most one compaction job runs at a time and its inputs stay probe-able", () => {
    const sim = createCompactionSim(13, { strategy: "leveled", ingestRate: 12 });
    sim.setAutoRead(false);
    let sawJob = false;
    for (let t = 0; t < 600; t++) {
      sim.step(100);
      const snap = sim.snapshot();
      if (snap.job) {
        sawJob = true;
        const onDiskIds = new Set(snap.levels.flat().map((r) => r.id));
        for (const id of snap.job.inputRunIds) {
          expect(onDiskIds.has(id), `input run ${id} still on disk`).toBe(true);
        }
      }
    }
    expect(sawJob).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Accounting: amplification meters and the disk budget.
// ---------------------------------------------------------------------------
describe("accounting", () => {
  it("write amplification = total entries written / user entries, and disk writes respect the budget", () => {
    const sim = createCompactionSim(21, { strategy: "leveled", ingestRate: 10 });
    sim.setAutoRead(false);
    const seconds = 90;
    for (let t = 0; t < seconds * 10; t++) sim.step(100);
    const snap = sim.snapshot();
    expect(snap.writeAmplification).toBeCloseTo(snap.totalEntriesWritten / snap.totalUserEntries, 10);
    // Disk writes (everything beyond the memtable inserts) cannot outrun the
    // budget by more than one flush of slack.
    const diskWrites = snap.totalEntriesWritten - snap.totalUserEntries;
    expect(diskWrites).toBeLessThanOrEqual(DISK_BUDGET_PER_SEC * seconds + KEY_COUNT);
  });

  it("space amplification = on-disk entries / unique live keys, and full compaction drives it to 1", () => {
    const sim = createCompactionSim(22, { strategy: "tiered", ingestRate: 16 });
    sim.setAutoRead(false);
    for (let t = 0; t < 600; t++) sim.step(100);
    sim.setIngestRate(0);
    settle(sim);
    const before = sim.snapshot();
    expect(before.spaceAmplification).toBeCloseTo(before.onDiskEntries / before.uniqueLiveOnDisk, 10);
    expect(before.spaceAmplification).toBeGreaterThan(1);

    sim.fullCompaction();
    // The in-flight merge holds inputs AND partial output: space spikes above
    // the pre-compaction footprint before it collapses.
    let peak = before.onDiskEntries;
    for (let t = 0; t < 600 && sim.snapshot().job; t++) {
      sim.step(100);
      peak = Math.max(peak, sim.snapshot().onDiskEntries);
    }
    expect(peak).toBeGreaterThan(before.onDiskEntries);

    const after = sim.snapshot();
    expect(after.runCount).toBe(1);
    expect(after.spaceAmplification).toBeCloseTo(1, 10);
  });

  it("read amplification equals probes along memtable -> L0 newest-first -> deeper levels", () => {
    const sim = quiet("tiered", 23);
    // Three flushed runs holding the same key, plus a miss key.
    for (let round = 0; round < 3; round++) {
      sim.write("k01", 100 + round);
      for (let i = 2; i < 9; i++) sim.write(keyName((i * 7) % KEY_COUNT), round);
      settle(sim, 3000);
    }
    const snap = sim.snapshot();
    expect(snap.l0RunCount).toBe(3);
    const hit = sim.read("k01");
    // Newest run holds the newest value: memtable miss + first run hit.
    expect(hit.value).toBe(102);
    expect(hit.readAmplification).toBe(2);
    const miss = sim.read("k63");
    expect(miss.found).toBe(false);
    expect(miss.readAmplification).toBe(1 + snap.runCount);
  });
});

// ---------------------------------------------------------------------------
// 4. The write stall (the breakable) and the strategy contrast.
// ---------------------------------------------------------------------------
describe("write stall and strategy trade-offs", () => {
  function run(strategy: Strategy, rate: number, seconds: number): CompactionSnapshot {
    const sim = createCompactionSim(42, { strategy, ingestRate: rate });
    for (let t = 0; t < seconds * 10; t++) sim.step(100);
    return sim.snapshot();
  }

  it("ingest beyond the budget drives L0 to the stop trigger and refuses writes (leveled)", () => {
    const sim = createCompactionSim(31, { strategy: "leveled", ingestRate: 20 });
    sim.setAutoRead(false);
    let stalledSeen = false;
    let l0AtStall = 0;
    for (let t = 0; t < 1200; t++) {
      sim.step(100);
      const s = sim.snapshot();
      expect(s.l0RunCount).toBeLessThanOrEqual(STOP_TRIGGER_RUNS); // never exceeds: stall holds the line
      if (s.stalled && !stalledSeen) {
        stalledSeen = true;
        l0AtStall = s.l0RunCount;
      }
    }
    expect(stalledSeen).toBe(true);
    expect(l0AtStall).toBe(STOP_TRIGGER_RUNS);
    expect(sim.snapshot().stalledWrites).toBeGreaterThan(0);
  });

  it("under the same overload, leveled pays in stalls, tiered pays in space and runs", () => {
    const leveled = run("leveled", 12, 120);
    const tiered = run("tiered", 12, 120);
    expect(leveled.stalledWrites).toBeGreaterThan(tiered.stalledWrites);
    expect(tiered.spaceAmplification).toBeGreaterThan(leveled.spaceAmplification);
    expect(leveled.writeAmplification).toBeGreaterThan(tiered.writeAmplification);
  });

  it("at a sustainable rate neither strategy stalls, and meters separate as documented", () => {
    const leveled = run("leveled", 6, 120);
    const tiered = run("tiered", 6, 120);
    expect(leveled.stalledWrites).toBe(0);
    expect(tiered.stalledWrites).toBe(0);
    expect(leveled.writeAmplification).toBeGreaterThan(tiered.writeAmplification);
    expect(tiered.spaceAmplification).toBeGreaterThan(leveled.spaceAmplification);
  });
});

// ---------------------------------------------------------------------------
// 5. Determinism and abuse.
// ---------------------------------------------------------------------------
describe("determinism and abuse", () => {
  function drive(sim: CompactionSim): CompactionSnapshot {
    sim.step(5000);
    sim.setStrategy("tiered");
    sim.step(5000);
    sim.fullCompaction();
    sim.step(3000);
    sim.setIngestRate(20);
    sim.step(4000);
    return sim.snapshot();
  }

  it("same seed, same schedule, same snapshot", () => {
    expect(drive(createCompactionSim(7))).toEqual(drive(createCompactionSim(7)));
  });

  it("reset reproduces the initial state and trajectory", () => {
    const fresh = drive(createCompactionSim(7));
    const reused = createCompactionSim(7);
    drive(reused);
    reused.reset();
    expect(reused.snapshot()).toEqual(createCompactionSim(7).snapshot());
    expect(drive(reused)).toEqual(fresh);
  });

  it("event spam never throws or corrupts", () => {
    const sim = createCompactionSim(8);
    sim.fullCompaction(); // nothing to merge
    sim.setStrategy("leveled"); // no-op, already leveled
    sim.step(0);
    sim.step(-100);
    sim.setIngestRate(999); // clamped
    expect(sim.snapshot().ingestRate).toBeLessThanOrEqual(24);
    sim.step(2000);
    sim.fullCompaction();
    sim.fullCompaction(); // refused: job already running
    for (let i = 0; i < 50; i++) {
      sim.read();
      sim.setStrategy(i % 2 ? "leveled" : "tiered");
      sim.step(50);
    }
    const snap = sim.snapshot();
    expect(snap.runCount).toBeGreaterThanOrEqual(0);
    expect(snap.spaceAmplification).toBeGreaterThanOrEqual(1);
  });

  it("SIMPLIFICATIONS is non-empty (the prose depends on it)", () => {
    expect(SIMPLIFICATIONS.length).toBeGreaterThan(0);
  });
});
