import { describe, it, expect } from "vitest";
import {
  createReplaySim,
  SIMPLIFICATIONS,
  type ReplaySim,
  type ReplaySnapshot,
  type Command,
} from "./replaySim";

// Deterministic op driver for sweeps, independent of Math.random.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Run a fresh original execution to completion in sim-time, returning the snapshot at
// every "stable" point (just after each event-driven advance) plus the final one.
function runOriginalToCompletion(sim: ReplaySim, bigStep = 2000): ReplaySnapshot[] {
  sim.start();
  const snaps: ReplaySnapshot[] = [sim.snapshot()];
  let guard = 64;
  while (sim.snapshot().status === "running" && guard-- > 0) {
    sim.step(bigStep);
    snaps.push(sim.snapshot());
  }
  return snaps;
}

// The command-producing events recorded in history, in order, as comparable strings.
function recordedCommandStrings(snap: ReplaySnapshot): string[] {
  return snap.events
    .filter(
      (e) =>
        e.type === "ActivityTaskScheduled" ||
        e.type === "TimerStarted" ||
        e.type === "WorkflowExecutionCompleted",
    )
    .map((e) => {
      if (e.type === "ActivityTaskScheduled") return `ActivityTaskScheduled(${e.activity})`;
      if (e.type === "TimerStarted") return `TimerStarted(${e.timerId})`;
      return "WorkflowExecutionCompleted";
    });
}

function commandString(c: Command): string {
  if (c.type === "ScheduleActivityTask") return `ScheduleActivityTask(${c.activity})`;
  if (c.type === "StartTimer") return `StartTimer(${c.timerId})`;
  return "CompleteWorkflowExecution";
}

// Independent oracle: re-derive the workflow's local state (chargeCard amount and the
// reserve-inventory branch decision) purely from a history snapshot. Replay must reach
// exactly this — history is the source of truth.
function oracleLocalState(snap: ReplaySnapshot): {
  amount: number | null;
  reserved: boolean;
  commandStream: string[];
} {
  const chargeCompleted = snap.events.find(
    (e) => e.type === "ActivityTaskCompleted" && e.activity === "chargeCard",
  );
  const amount = chargeCompleted?.result ?? null;
  const reserved = snap.events.some(
    (e) => e.type === "ActivityTaskScheduled" && e.activity === "reserveInventory",
  );
  return { amount, reserved, commandStream: recordedCommandStrings(snap) };
}

describe("replaySim — replay reconstruction (crash-point sweep)", () => {
  it("for any crash point, replay reconstructs the same local state + command stream the worker had", () => {
    for (let seed = 1; seed <= 40; seed++) {
      // Drive the original run forward by a random number of sim-time advances, then
      // crash. The crash point varies across the whole workflow.
      const r = lcg(seed);
      const advances = Math.floor(r() * 6); // 0..5 event-driven advances before crash

      const sim = createReplaySim(seed);
      sim.start();
      for (let i = 0; i < advances && sim.snapshot().status === "running"; i++) {
        sim.step(2000);
      }
      if (sim.snapshot().status !== "running") continue; // already completed; covered elsewhere

      const preCrash = sim.snapshot();
      // What the pre-crash worker's local state must be, derived from the history it had.
      const expected = oracleLocalState(preCrash);
      const preCommands = preCrash.commands.map(commandString);

      sim.crashWorker();
      sim.startReplay();

      // Run replay until it leaves the replaying phase (history edge reached). The last
      // snapshot before the local state is overwritten by live continuation reflects the
      // reconstructed workflow state; the final comparison strip holds every matched row.
      let guard = 64;
      let lastReplaying = sim.snapshot();
      while (sim.snapshot().status === "replaying" && guard-- > 0) {
        lastReplaying = sim.snapshot();
        sim.replayStep();
      }
      const atEdge = sim.snapshot();

      // Replay's matched command stream is exactly the recorded command stream the
      // pre-crash worker had produced (history is the source of truth, no divergence).
      // The comparison strip records the matched event (recorded side) in event form.
      const matchedStream = atEdge.comparison
        .filter((c) => c.outcome === "match")
        .map((c) => c.recorded);
      // The pre-crash worker's command-producing history is reproduced, in order.
      expect(matchedStream).toEqual(expected.commandStream);

      // The reconstructed local state equals the oracle (recorded amount + branch). Use
      // the last replaying snapshot, before live continuation advances the workflow.
      expect(lastReplaying.code.amount).toBe(expected.amount);
      if (expected.amount !== null) {
        expect(lastReplaying.code.reserved).toBe(expected.reserved);
      }
      // The pre-crash worker had a single pending command; replay reproduced its slot.
      expect(preCommands.length).toBeLessThanOrEqual(1);
    }
  });
});

describe("replaySim — recorded results, not re-execution", () => {
  it("no activity re-runs during replay; branch follows the RECORDED chargeCard result", () => {
    // Find a seed where the original chargeCard amount drove the >100 branch (reserved).
    let chosen = -1;
    for (let seed = 1; seed <= 200 && chosen < 0; seed++) {
      const sim = createReplaySim(seed);
      const snaps = runOriginalToCompletion(sim);
      const final = snaps[snaps.length - 1];
      const charge = final.activities.find((a) => a.activity === "chargeCard");
      if (charge && charge.result !== undefined && charge.result > 100) chosen = seed;
    }
    expect(chosen).toBeGreaterThan(0);

    const sim = createReplaySim(chosen);
    runOriginalToCompletion(sim);
    // Crash a fresh run mid-workflow so there is real replay work to do.
    const sim2 = createReplaySim(chosen);
    sim2.start();
    sim2.step(2000); // chargeCard completes
    sim2.step(2000); // reserveInventory (taken because amount>100) completes
    const beforeReplay = sim2.snapshot();
    expect(beforeReplay.status).toBe("running");
    const chargeAmount = beforeReplay.activities.find(
      (a) => a.activity === "chargeCard",
    )!.result!;
    expect(chargeAmount).toBeGreaterThan(100);

    sim2.crashWorker();
    sim2.startReplay();
    const execAtReplayStart = sim2.snapshot().activityExecCount;

    // Step through the replaying phase only: the activity-execution counter must not
    // move while replaying (results come from history, not re-execution).
    let guard = 32;
    while (sim2.snapshot().status === "replaying" && guard-- > 0) {
      sim2.replayStep();
      if (sim2.snapshot().status === "replaying") {
        expect(sim2.snapshot().activityExecCount).toBe(execAtReplayStart);
      }
    }

    sim2.replayAll();
    const afterReplay = sim2.snapshot();

    // The replay's reconstructed branch used the RECORDED amount: reserved branch taken.
    const reservedScheduled = afterReplay.comparison.some(
      (c) => c.emitted === "ScheduleActivityTask(reserveInventory)" && c.outcome === "match",
    );
    expect(reservedScheduled).toBe(true);
  });

  it("the replaying phase never increments the activity-execution counter", () => {
    const sim = createReplaySim(7);
    sim.start();
    sim.step(2000); // chargeCard completes (executes once, recorded)
    expect(sim.snapshot().status).toBe("running");

    sim.crashWorker();
    sim.startReplay();
    const execAtStart = sim.snapshot().activityExecCount;

    let guard = 32;
    while (sim.snapshot().status === "replaying" && guard-- > 0) {
      sim.replayStep();
      if (sim.snapshot().status === "replaying") {
        expect(sim.snapshot().activityExecCount).toBe(execAtStart);
      }
    }
  });
});

describe("replaySim — nondeterminism detection", () => {
  it("injection on: replay after crash fails with a mismatch naming emitted vs expected", () => {
    const sim = createReplaySim(4);
    // Original run WITHOUT nondeterminism: records a clean history.
    sim.start();
    sim.step(2000); // chargeCard completes
    const running = sim.snapshot();
    expect(running.status).toBe("running");

    sim.crashWorker();
    // Now inject nondeterminism: the replayed branch consults the context clock, which
    // differs from the recorded chargeCard amount, so the emitted command diverges.
    sim.setNondeterminism(true);
    sim.startReplay();
    sim.replayAll();
    const after = sim.snapshot();

    expect(after.status).toBe("failed-nondeterminism");
    expect(after.nondeterminismError).toBeTruthy();
    expect(after.nondeterminismError!).toMatch(/replay emitted/);
    expect(after.nondeterminismError!).toMatch(/history expected/);
    // There is a mismatch row in the comparison strip.
    expect(after.comparison.some((c) => c.outcome === "mismatch")).toBe(true);
    // Workflow never completes.
    expect(after.events.some((e) => e.type === "WorkflowExecutionCompleted")).toBe(false);
    expect(after.status).not.toBe("completed");
  });

  it("a failed nondeterministic replay does not modify history", () => {
    // Use a seed whose original run takes the >100 branch so flipping it on replay is a
    // genuine divergence somewhere in the command stream.
    let chosen = -1;
    for (let seed = 1; seed <= 200 && chosen < 0; seed++) {
      const probe = createReplaySim(seed);
      runOriginalToCompletion(probe);
      const f = probe.snapshot();
      const charge = f.activities.find((a) => a.activity === "chargeCard");
      if (charge?.result !== undefined && charge.result > 100) chosen = seed;
    }
    expect(chosen).toBeGreaterThan(0);

    const sim = createReplaySim(chosen);
    sim.start();
    sim.step(2000);
    sim.step(2000);
    sim.crashWorker();
    const historyBeforeReplay = JSON.parse(
      JSON.stringify(sim.snapshot().events.map((e) => ({ ...e, replayCursor: false }))),
    );

    sim.setNondeterminism(true);
    sim.startReplay();
    sim.replayAll();
    const after = sim.snapshot();
    expect(after.status).toBe("failed-nondeterminism");

    const historyAfterReplay = after.events.map((e) => ({ ...e, replayCursor: false }));
    expect(historyAfterReplay).toEqual(historyBeforeReplay);
  });
});

describe("replaySim — clean replay completes", () => {
  it("without injection, replay then live continuation completes the workflow", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const sim = createReplaySim(seed);
      sim.start();
      sim.step(2000); // chargeCard completes; crash mid-workflow
      if (sim.snapshot().status !== "running") continue;

      sim.crashWorker();
      sim.startReplay();
      sim.replayAll();
      const after = sim.snapshot();

      expect(after.status, `seed ${seed}`).toBe("completed");

      // Final history is valid: every Scheduled activity has a matching Completed,
      // and history ends with WorkflowExecutionCompleted.
      const scheduled = after.events.filter((e) => e.type === "ActivityTaskScheduled");
      const completed = after.events.filter((e) => e.type === "ActivityTaskCompleted");
      expect(completed.length).toBe(scheduled.length);
      for (const s of scheduled) {
        expect(
          completed.some((c) => c.activity === s.activity),
          `activity ${s.activity} has a completion`,
        ).toBe(true);
      }
      const last = after.events[after.events.length - 1];
      expect(last.type).toBe("WorkflowExecutionCompleted");

      // Every started timer fired.
      const timersStarted = after.events.filter((e) => e.type === "TimerStarted");
      const timersFired = after.events.filter((e) => e.type === "TimerFired");
      expect(timersFired.length).toBe(timersStarted.length);
    }
  });

  it("a full uninterrupted original run completes with a valid history", () => {
    const sim = createReplaySim(9);
    const snaps = runOriginalToCompletion(sim);
    const after = snaps[snaps.length - 1];
    expect(after.status).toBe("completed");
    const last = after.events[after.events.length - 1];
    expect(last.type).toBe("WorkflowExecutionCompleted");
  });
});

describe("replaySim — history append-only", () => {
  it("eventIds are strictly increasing across the whole lifecycle", () => {
    const sim = createReplaySim(2);
    sim.start();
    sim.step(2000);
    sim.crashWorker();
    sim.startReplay();
    sim.replayAll();
    const after = sim.snapshot();
    for (let i = 1; i < after.events.length; i++) {
      expect(after.events[i].eventId).toBeGreaterThan(after.events[i - 1].eventId);
    }
  });

  it("replay never mutates existing event payloads (deep compare before/after)", () => {
    const sim = createReplaySim(8);
    sim.start();
    sim.step(2000);
    sim.crashWorker();

    const before = sim
      .snapshot()
      .events.map((e) => ({ ...e, replayCursor: false }));
    sim.startReplay();
    sim.replayAll();
    const after = sim.snapshot();

    // The prefix of events that existed before replay is unchanged (ignoring the
    // viz-only replayCursor flag). Live continuation may APPEND new events.
    const afterPrefix = after.events
      .slice(0, before.length)
      .map((e) => ({ ...e, replayCursor: false }));
    expect(afterPrefix).toEqual(before);
  });
});

describe("replaySim — determinism", () => {
  it("same seed + identical call sequence => JSON-equal snapshots at every step", () => {
    const seed = 17;
    const a = createReplaySim(seed);
    const b = createReplaySim(seed);
    const calls: Array<(s: ReplaySim) => void> = [
      (s) => s.start(),
      (s) => s.step(2000),
      (s) => s.step(2000),
      (s) => s.crashWorker(),
      (s) => s.startReplay(),
      (s) => s.replayStep(),
      (s) => s.replayStep(),
      (s) => s.replayAll(),
    ];
    for (const call of calls) {
      call(a);
      call(b);
      expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    }
  });

  it("reset returns to a deterministic initial state for the same seed", () => {
    const a = createReplaySim(42);
    const fresh = JSON.stringify(a.snapshot());
    a.start();
    a.step(2000);
    a.crashWorker();
    a.startReplay();
    a.replayAll();
    a.reset();
    expect(JSON.stringify(a.snapshot())).toBe(fresh);
  });
});

describe("replaySim — event-in-any-state safety (spam)", () => {
  it("spamming every method in every status never throws or corrupts", () => {
    const sim = createReplaySim(13);

    const driveTo = (
      target: "idle" | "running" | "crashed" | "replaying" | "completed",
    ): void => {
      sim.reset();
      if (target === "idle") return;
      sim.start();
      if (target === "running") return;
      sim.step(2000);
      sim.crashWorker();
      if (target === "crashed") return;
      sim.startReplay();
      if (target === "replaying") return;
      sim.replayAll();
    };

    const spam = (): void => {
      sim.step(500);
      sim.start();
      sim.crashWorker();
      sim.startReplay();
      sim.replayStep();
      sim.replayAll();
      sim.setNondeterminism(true);
      sim.setNondeterminism(false);
    };

    for (const target of ["idle", "running", "crashed", "replaying", "completed"] as const) {
      driveTo(target);
      for (let i = 0; i < 20; i++) {
        expect(() => spam()).not.toThrow();
        const s = sim.snapshot();
        // eventIds always strictly increasing
        for (let j = 1; j < s.events.length; j++) {
          expect(s.events[j].eventId).toBeGreaterThan(s.events[j - 1].eventId);
        }
        // matched + mismatched comparison rows never exceed recorded command events
        const recorded = recordedCommandStrings(s).length;
        const usedRows = s.comparison.length;
        expect(usedRows).toBeLessThanOrEqual(recorded + 1);
      }
    }
  });

  it("replay before crash is a no-op; double start is a no-op", () => {
    const sim = createReplaySim(1);
    sim.startReplay(); // before anything
    expect(sim.snapshot().status).toBe("idle");
    sim.replayStep();
    expect(sim.snapshot().status).toBe("idle");

    sim.start();
    const after1 = sim.snapshot().events.length;
    sim.start(); // double start no-op
    expect(sim.snapshot().events.length).toBe(after1);

    sim.startReplay(); // while running: no-op
    expect(sim.snapshot().status).toBe("running");
  });

  it("crash during replay leaves a sane snapshot", () => {
    const sim = createReplaySim(3);
    sim.start();
    sim.step(2000);
    sim.crashWorker();
    sim.startReplay();
    expect(() => sim.crashWorker()).not.toThrow(); // crash while replaying: ignored
    const s = sim.snapshot();
    expect(["replaying", "completed", "running"]).toContain(s.status);
  });
});

describe("replaySim — metadata", () => {
  it("exports a non-empty SIMPLIFICATIONS list", () => {
    expect(Array.isArray(SIMPLIFICATIONS)).toBe(true);
    expect(SIMPLIFICATIONS.length).toBeGreaterThan(3);
    expect(SIMPLIFICATIONS.every((s) => typeof s === "string" && s.length > 0)).toBe(true);
  });
});
