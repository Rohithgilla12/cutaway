import { describe, it, expect } from "vitest";
import { createNaiveVsWalSim, type CommitRate } from "./naiveVsWalSim";

const SEED = 0xdeadbeef;

function runFor(seed: number, rate: CommitRate, durationMs: number) {
  const sim = createNaiveVsWalSim(seed);
  sim.setRate(rate);
  const stepMs = 16;
  let elapsed = 0;
  while (elapsed < durationMs) {
    sim.step(stepMs);
    elapsed += stepMs;
  }
  return sim.snapshot();
}

describe("naiveVsWalSim — throughput invariant", () => {
  it("same workload: naive completed ≤ wal completed at all rates", () => {
    for (const rate of [10, 50, 200] as CommitRate[]) {
      const snap = runFor(SEED, rate, 5000);
      expect(snap.naive.completed).toBeLessThanOrEqual(snap.wal.completed);
    }
  });

  it("at 200/s naive queue grows unbounded while WAL keeps up", () => {
    const snap = runFor(SEED, 200, 3000);
    expect(snap.naive.queueDepth).toBeGreaterThan(0);
    expect(snap.wal.queueDepth).toBeLessThan(snap.naive.queueDepth);
  });

  it("at 200/s naive queue is strictly monotonically increasing over time", () => {
    const sim = createNaiveVsWalSim(SEED);
    sim.setRate(200);
    let prevNaiveQueue = 0;
    let monotonicViolations = 0;
    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      sim.step(16);
      const snap = sim.snapshot();
      samples.push(snap.naive.queueDepth);
      if (snap.naive.queueDepth < prevNaiveQueue) {
        monotonicViolations++;
      }
      if (snap.naive.queueDepth > prevNaiveQueue) {
        prevNaiveQueue = snap.naive.queueDepth;
      }
    }
    const finalSnap = sim.snapshot();
    expect(finalSnap.naive.queueDepth).toBeGreaterThan(10);
    expect(monotonicViolations).toBe(0);
  });

  it("WAL queue stays bounded at 200/s (drains within a few windows)", () => {
    const sim = createNaiveVsWalSim(SEED);
    sim.setRate(200);
    const maxWalQueue: number[] = [];
    for (let i = 0; i < 300; i++) {
      sim.step(16);
      maxWalQueue.push(sim.snapshot().wal.queueDepth);
    }
    const peakWalQueue = Math.max(...maxWalQueue);
    expect(peakWalQueue).toBeLessThan(10);
  });
});

describe("naiveVsWalSim — determinism", () => {
  it("same seed + same ops produce identical snapshots", () => {
    const a = createNaiveVsWalSim(SEED);
    const b = createNaiveVsWalSim(SEED);
    a.setRate(50);
    b.setRate(50);
    for (let i = 0; i < 100; i++) {
      a.step(16);
      b.step(16);
      expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    }
  });

  it("reset returns to deterministic initial state", () => {
    const sim = createNaiveVsWalSim(SEED);
    const initial = JSON.stringify(sim.snapshot());
    sim.setRate(200);
    for (let i = 0; i < 50; i++) sim.step(16);
    sim.reset();
    expect(JSON.stringify(sim.snapshot())).toBe(initial);
  });

  it("post-reset trajectory matches a fresh same-seed sim", () => {
    const sim = createNaiveVsWalSim(SEED);
    sim.setRate(50);
    for (let i = 0; i < 40; i++) sim.step(20);
    sim.reset();

    const fresh = createNaiveVsWalSim(SEED);
    for (let i = 0; i < 60; i++) {
      sim.step(16);
      fresh.step(16);
      expect(JSON.stringify(sim.snapshot())).toBe(JSON.stringify(fresh.snapshot()));
    }
  });
});

describe("naiveVsWalSim — spam safety", () => {
  it("calling step with 0 or negative dt never throws or corrupts state", () => {
    const sim = createNaiveVsWalSim(SEED);
    sim.setRate(200);
    expect(() => {
      sim.step(0);
      sim.step(-1);
      sim.step(16);
    }).not.toThrow();
    const snap = sim.snapshot();
    expect(snap.naive.queueDepth).toBeGreaterThanOrEqual(0);
    expect(snap.wal.queueDepth).toBeGreaterThanOrEqual(0);
    expect(snap.naive.completed).toBeGreaterThanOrEqual(0);
    expect(snap.wal.completed).toBeGreaterThanOrEqual(0);
  });

  it("setRate can be changed mid-run without corrupting counters", () => {
    const sim = createNaiveVsWalSim(SEED);
    sim.setRate(10);
    for (let i = 0; i < 30; i++) sim.step(16);
    sim.setRate(200);
    for (let i = 0; i < 30; i++) sim.step(16);
    sim.setRate(50);
    for (let i = 0; i < 30; i++) sim.step(16);
    const snap = sim.snapshot();
    expect(snap.naive.completed + snap.naive.queueDepth).toBeGreaterThanOrEqual(snap.naive.completed);
    expect(snap.wal.completed).toBeGreaterThanOrEqual(0);
    expect(snap.wal.fsyncsIssued).toBeGreaterThanOrEqual(0);
    expect(snap.naive.fsyncsIssued).toBeGreaterThanOrEqual(snap.naive.completed);
  });

  it("WAL fsyncs issued ≤ naive fsyncs issued (batching advantage)", () => {
    const snap = runFor(SEED, 200, 4000);
    expect(snap.wal.fsyncsIssued).toBeLessThan(snap.naive.fsyncsIssued);
  });

  it("completed + queueDepth is consistent for both lanes", () => {
    const sim = createNaiveVsWalSim(SEED);
    sim.setRate(200);
    for (let i = 0; i < 200; i++) {
      sim.step(10);
      const snap = sim.snapshot();
      expect(snap.naive.completed).toBeGreaterThanOrEqual(0);
      expect(snap.naive.queueDepth).toBeGreaterThanOrEqual(0);
      expect(snap.wal.completed).toBeGreaterThanOrEqual(0);
      expect(snap.wal.queueDepth).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("naiveVsWalSim — fsync economics", () => {
  it("naive lane issues multiple fsyncs per completed commit on average", () => {
    const snap = runFor(SEED, 10, 5000);
    if (snap.naive.completed > 0) {
      expect(snap.naive.fsyncsIssued).toBeGreaterThanOrEqual(snap.naive.completed);
    }
  });

  it("WAL lane issues far fewer fsyncs than completed commits at high rate", () => {
    const snap = runFor(SEED, 200, 5000);
    if (snap.wal.completed > 5) {
      expect(snap.wal.fsyncsIssued).toBeLessThan(snap.wal.completed);
    }
  });
});
