import { describe, it, expect } from "vitest";
import { createSweeperSim, SWEEPER_INTERVAL_MS } from "./sweeperSim";

function advanceUntil(sim: ReturnType<typeof createSweeperSim>, condition: () => boolean, maxMs: number): boolean {
  const TICK = 50;
  let elapsed = 0;
  while (elapsed < maxMs) {
    if (condition()) return true;
    sim.step(TICK);
    elapsed += TICK;
  }
  return condition();
}

describe("sweeperSim — crash in gap ⇒ double charge", () => {
  it("crash during gap phase then sweeper fires ⇒ chargeCount === 2", () => {
    const sim = createSweeperSim(1);
    sim.start();

    // Step past charging phase to enter gap
    sim.step(600);
    expect(sim.snapshot().workerPhase).toBe("gap");
    expect(sim.snapshot().chargeCount).toBe(1);

    sim.crashWorker();
    expect(sim.snapshot().workerAlive).toBe(false);
    // status must still be pending — crash happened before status write
    expect(sim.snapshot().orderStatus).toBe("pending");

    // Advance until sweeper fires (at most 2 full intervals)
    const fired = advanceUntil(sim, () => sim.snapshot().chargeCount >= 2, SWEEPER_INTERVAL_MS * 2 + 100);
    expect(fired).toBe(true);
    expect(sim.snapshot().chargeCount).toBe(2);
    // Sweeper wrote status=charged after re-charging
    expect(sim.snapshot().orderStatus).toBe("charged");
  });
});

describe("sweeperSim — happy path (no crash)", () => {
  it("no crash ⇒ chargeCount === 1 and emailCount === 1 at completion", () => {
    const sim = createSweeperSim(2);
    sim.start();

    const done = advanceUntil(sim, () => sim.snapshot().orderStatus === "done", 20000);
    expect(done).toBe(true);
    expect(sim.snapshot().chargeCount).toBe(1);
    expect(sim.snapshot().emailCount).toBe(1);
  });
});

describe("sweeperSim — crash AFTER status write ⇒ no double charge", () => {
  it("crash after gap ends (status already charged) ⇒ chargeCount stays 1", () => {
    const sim = createSweeperSim(3);
    sim.start();

    // Step past charging (600ms) and gap (300ms) so status becomes "charged"
    sim.step(600);
    sim.step(300);

    // Give a tiny extra tick to ensure the gap transition has fired
    sim.step(50);

    const snap = sim.snapshot();
    // At minimum chargeCount is 1; status should be charged (gap ended)
    expect(snap.chargeCount).toBe(1);
    expect(snap.orderStatus).toBe("charged");

    sim.crashWorker();

    // Advance until sweeper fires
    advanceUntil(sim, () => sim.snapshot().clockMs > snap.clockMs + SWEEPER_INTERVAL_MS, SWEEPER_INTERVAL_MS * 2 + 100);

    // Sweeper saw "charged" not "pending" — no second charge
    expect(sim.snapshot().chargeCount).toBe(1);
  });
});

describe("sweeperSim — determinism", () => {
  it("same seed + same calls ⇒ JSON-equal snapshots at every step", () => {
    const seed = 42;
    const a = createSweeperSim(seed);
    const b = createSweeperSim(seed);

    const calls: Array<(s: ReturnType<typeof createSweeperSim>) => void> = [
      (s) => s.start(),
      (s) => s.step(200),
      (s) => s.step(400),
      (s) => s.step(300),
      (s) => s.crashWorker(),
      (s) => s.step(SWEEPER_INTERVAL_MS),
      (s) => s.restartWorker(),
      (s) => s.step(500),
    ];

    for (const call of calls) {
      call(a);
      call(b);
      expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    }
  });
});

describe("sweeperSim — spam safety", () => {
  it("calling start/crash/restart/reset in any state never throws", () => {
    const sim = createSweeperSim(99);

    expect(() => {
      sim.start();
      sim.crashWorker();
      sim.restartWorker();
      sim.reset();
      sim.start();
      sim.step(100);
      sim.crashWorker();
      sim.step(100);
      sim.restartWorker();
      sim.step(50);
      sim.crashWorker();
      sim.reset();
      sim.start();
      sim.step(600);
      sim.step(300);
      sim.crashWorker();
      sim.restartWorker();
      sim.step(SWEEPER_INTERVAL_MS);
      sim.reset();
    }).not.toThrow();

    const snap = sim.snapshot();
    expect(snap.chargeCount).toBeGreaterThanOrEqual(0);
    expect(snap.emailCount).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(snap.chargeCount)).toBe(true);
    expect(Number.isInteger(snap.emailCount)).toBe(true);
  });
});

describe("sweeperSim — no crash ⇒ chargeCount exactly 1", () => {
  it("running to done without any crash yields chargeCount === 1", () => {
    const sim = createSweeperSim(7);
    sim.start();

    advanceUntil(sim, () => sim.snapshot().orderStatus === "done", 20000);

    expect(sim.snapshot().orderStatus).toBe("done");
    expect(sim.snapshot().chargeCount).toBe(1);
  });
});
