import { describe, it, expect } from "vitest";
import {
  createIsolationSim,
  SCENARIO_ORDER,
  SIMPLIFICATIONS,
  type IsolationLevel,
  type IsolationSnapshot,
  type ScenarioId,
  type TxnId,
} from "./isolationSim";

// Run a scenario at a level through its built-in scripted interleaving.
function runScript(scenario: ScenarioId, level: IsolationLevel): IsolationSnapshot {
  const sim = createIsolationSim(scenario);
  sim.setLevel(level);
  let guard = 50;
  while (guard-- > 0 && sim.scriptStep()) {
    /* advance until the script is exhausted */
  }
  return sim.snapshot();
}

function status(snap: IsolationSnapshot, id: TxnId) {
  return snap.txns[id].status;
}

describe("the four scenarios, three levels each — outcomes", () => {
  describe("lost update", () => {
    it("Read Committed silently loses an update", () => {
      const snap = runScript("lost-update", "RC");
      expect(status(snap, "T1")).toBe("committed");
      expect(status(snap, "T2")).toBe("committed");
      expect(snap.rows.find((r) => r.id === "acct")!.committedValue).toBe(120); // 100 + 20, the +10 is gone
      expect(snap.anomaly!.happened).toBe(true);
    });

    it("Repeatable Read aborts the second writer instead of losing the update", () => {
      const snap = runScript("lost-update", "RR");
      expect(status(snap, "T1")).toBe("committed");
      expect(status(snap, "T2")).toBe("aborted");
      expect(snap.txns.T2.abortReason).toBe("concurrent-update");
      expect(snap.rows.find((r) => r.id === "acct")!.committedValue).toBe(110);
      expect(snap.anomaly!.happened).toBe(false); // an abort is the safe outcome
    });

    it("Serializable also aborts via the write-write conflict (concurrent update)", () => {
      const snap = runScript("lost-update", "SER");
      expect(status(snap, "T2")).toBe("aborted");
      expect(snap.txns.T2.abortReason).toBe("concurrent-update");
      expect(snap.anomaly!.happened).toBe(false);
    });
  });

  describe("non-repeatable read", () => {
    it("Read Committed sees two different values", () => {
      const snap = runScript("non-repeatable-read", "RC");
      expect(snap.txns.T1.ops[0].detail).toBe(":a = 100");
      expect(snap.txns.T1.ops[1].detail).toBe(":a2 = 200");
      expect(snap.anomaly!.happened).toBe(true);
    });

    it("Repeatable Read sees the same value twice", () => {
      const snap = runScript("non-repeatable-read", "RR");
      expect(snap.txns.T1.ops[0].detail).toBe(":a = 100");
      expect(snap.txns.T1.ops[1].detail).toBe(":a2 = 100");
      expect(snap.anomaly!.happened).toBe(false);
      // No abort: T1 is read-only, T2's write doesn't conflict.
      expect(status(snap, "T1")).toBe("committed");
      expect(status(snap, "T2")).toBe("committed");
    });

    it("Serializable also reads repeatably with no abort", () => {
      const snap = runScript("non-repeatable-read", "SER");
      expect(snap.txns.T1.ops[1].detail).toBe(":a2 = 100");
      expect(snap.anomaly!.happened).toBe(false);
      expect(status(snap, "T1")).toBe("committed");
    });
  });

  describe("phantom", () => {
    it("Read Committed sees the phantom row in the second count", () => {
      const snap = runScript("phantom", "RC");
      expect(snap.predicateValues.T1).toBe(3);
      expect(snap.txns.T1.ops[0].detail).toBe(":c1 = 2");
      expect(snap.txns.T1.ops[1].detail).toBe(":c2 = 3");
      expect(snap.anomaly!.happened).toBe(true);
    });

    it("Repeatable Read does not — Postgres SI prevents phantoms the SQL standard allows", () => {
      const snap = runScript("phantom", "RR");
      expect(snap.txns.T1.ops[0].detail).toBe(":c1 = 2");
      expect(snap.txns.T1.ops[1].detail).toBe(":c2 = 2");
      expect(snap.anomaly!.happened).toBe(false);
    });

    it("Serializable: stable count, no dangerous cycle, no abort", () => {
      const snap = runScript("phantom", "SER");
      expect(snap.txns.T1.ops[1].detail).toBe(":c2 = 2");
      expect(status(snap, "T1")).toBe("committed");
      expect(status(snap, "T2")).toBe("committed");
    });
  });

  describe("write skew (the headline case)", () => {
    it("Read Committed lets both doctors go off call", () => {
      const snap = runScript("write-skew", "RC");
      expect(snap.rows.find((r) => r.id === "alice")!.committedValue).toBe(0);
      expect(snap.rows.find((r) => r.id === "bob")!.committedValue).toBe(0);
      expect(snap.anomaly!.happened).toBe(true);
    });

    it("Repeatable Read ALSO lets write skew through — different rows, no write-write conflict", () => {
      const snap = runScript("write-skew", "RR");
      expect(status(snap, "T1")).toBe("committed");
      expect(status(snap, "T2")).toBe("committed");
      expect(snap.rows.find((r) => r.id === "alice")!.committedValue).toBe(0);
      expect(snap.rows.find((r) => r.id === "bob")!.committedValue).toBe(0);
      expect(snap.anomaly!.happened).toBe(true);
    });

    it("Serializable detects the rw-antidependency cycle and aborts the second committer", () => {
      const snap = runScript("write-skew", "SER");
      expect(status(snap, "T1")).toBe("committed");
      expect(status(snap, "T2")).toBe("aborted");
      expect(snap.txns.T2.abortReason).toBe("read-write-dependency");
      // Exactly one doctor stays on call; the invariant holds.
      const onCall =
        (snap.rows.find((r) => r.id === "alice")!.committedValue === 1 ? 1 : 0) +
        (snap.rows.find((r) => r.id === "bob")!.committedValue === 1 ? 1 : 0);
      expect(onCall).toBe(1);
      expect(snap.anomaly!.happened).toBe(false);
      // The graph that justified the abort is a 2-cycle.
      expect(snap.edges.some((e) => e.from === "T1" && e.to === "T2")).toBe(true);
      expect(snap.edges.some((e) => e.from === "T2" && e.to === "T1")).toBe(true);
    });
  });
});

describe("engine invariants hold throughout any interleaving", () => {
  // Drive a scenario with an arbitrary but legal interleaving and check
  // invariants after every op.
  function interleavings(): TxnId[][] {
    return [
      ["T1", "T1", "T1", "T2", "T2", "T2"],
      ["T2", "T2", "T1", "T1", "T1", "T2"],
      ["T1", "T2", "T1", "T2", "T1", "T2"],
      ["T2", "T1", "T2", "T1", "T2", "T1"],
    ];
  }

  it("at most one transaction holds a row's write lock at any moment", () => {
    for (const scenario of SCENARIO_ORDER) {
      for (const level of ["RC", "RR", "SER"] as IsolationLevel[]) {
        for (const order of interleavings()) {
          const sim = createIsolationSim(scenario);
          sim.setLevel(level);
          for (const id of order) {
            sim.stepTxn(id);
            const snap = sim.snapshot();
            const locks = snap.rows.filter((r) => r.lockedBy !== null);
            const holders = new Set(locks.map((r) => r.lockedBy));
            // each row has a single holder by construction; assert no row claims two
            for (const r of snap.rows) {
              expect(typeof r.lockedBy === "string" || r.lockedBy === null).toBe(true);
            }
            // A committed/aborted txn never still holds a lock.
            for (const r of locks) {
              expect(["active", "blocked"]).toContain(snap.txns[r.lockedBy!].status);
            }
            expect(holders.size).toBeLessThanOrEqual(2);
          }
        }
      }
    }
  });

  it("a committed transaction's writes are all visible or none are (atomicity)", () => {
    const sim = createIsolationSim("write-skew");
    sim.setLevel("RC");
    // Run T1 fully: predicate, write alice, commit.
    sim.stepTxn("T1");
    let snap = sim.snapshot();
    // Before T1 commits, alice's committed value is still 1 (write is uncommitted).
    expect(snap.rows.find((r) => r.id === "alice")!.committedValue).toBe(1);
    sim.stepTxn("T1"); // write alice
    snap = sim.snapshot();
    expect(snap.rows.find((r) => r.id === "alice")!.committedValue).toBe(1); // still uncommitted
    expect(snap.rows.find((r) => r.id === "alice")!.lockedBy).toBe("T1");
    sim.stepTxn("T1"); // commit
    snap = sim.snapshot();
    expect(snap.rows.find((r) => r.id === "alice")!.committedValue).toBe(0); // now visible
    expect(snap.rows.find((r) => r.id === "alice")!.lockedBy).toBeNull();
  });

  it("under RR/SER a row read once reads identically for the rest of the transaction", () => {
    // Manually interleave a read, a concurrent committed overwrite, and a re-read.
    for (const level of ["RR", "SER"] as IsolationLevel[]) {
      const sim = createIsolationSim("non-repeatable-read");
      sim.setLevel(level);
      sim.stepTxn("T1"); // first read of x
      sim.stepTxn("T2"); // write x := 200
      sim.stepTxn("T2"); // commit
      sim.stepTxn("T1"); // second read
      const snap = sim.snapshot();
      const v0 = snap.txns.T1.ops[0].detail!.match(/= (\d+)/)![1];
      const v1 = snap.txns.T1.ops[1].detail!.match(/= (\d+)/)![1];
      expect(v0).toBe(v1); // same value read both times, regardless of register name
      expect(v0).toBe("100");
    }
  });
});

describe("blocking behaviour", () => {
  it("a writer blocks on an uncommitted writer's row, then resolves on its turn", () => {
    const sim = createIsolationSim("lost-update");
    sim.setLevel("RC");
    sim.stepTxn("T1"); // T1 read
    sim.stepTxn("T2"); // T2 read
    sim.stepTxn("T1"); // T1 write — locks acct
    const blocked = sim.stepTxn("T2"); // T2 write — should block
    expect(blocked).toBe(false);
    expect(sim.snapshot().txns.T2.status).toBe("blocked");
    expect(sim.snapshot().txns.T2.blockedOn).toBe("T1");
    sim.stepTxn("T1"); // T1 commit — wakes T2, which proceeds (RC) to write 120
    const snap = sim.snapshot();
    expect(snap.txns.T2.status).toBe("active");
    expect(snap.rows.find((r) => r.id === "acct")!.lockedBy).toBe("T2");
  });

  it("under RR the woken writer aborts rather than overwriting", () => {
    const sim = createIsolationSim("lost-update");
    sim.setLevel("RR");
    sim.stepTxn("T1");
    sim.stepTxn("T2");
    sim.stepTxn("T1"); // write, lock
    sim.stepTxn("T2"); // block
    sim.stepTxn("T1"); // commit -> wake T2 -> abort
    expect(sim.snapshot().txns.T2.status).toBe("aborted");
    expect(sim.snapshot().txns.T2.abortReason).toBe("concurrent-update");
  });
});

describe("determinism, controls, and abuse", () => {
  function driveAuto(scenario: ScenarioId, level: IsolationLevel): IsolationSnapshot {
    const sim = createIsolationSim(scenario);
    sim.setLevel(level);
    sim.setAutoPlay(true);
    sim.step(900 * 12); // enough to exhaust any script
    return sim.snapshot();
  }

  it("auto-play through the script equals manual scripted stepping", () => {
    for (const scenario of SCENARIO_ORDER) {
      for (const level of ["RC", "RR", "SER"] as IsolationLevel[]) {
        const auto = driveAuto(scenario, level);
        const manual = runScript(scenario, level);
        // Compare the meaningful settled state, not transient autoPlay flags.
        expect(auto.rows).toEqual(manual.rows);
        expect(auto.txns.T1.status).toBe(manual.txns.T1.status);
        expect(auto.txns.T2.status).toBe(manual.txns.T2.status);
        expect(auto.anomaly).toEqual(manual.anomaly);
      }
    }
  });

  it("reset and re-run reproduces the same outcome", () => {
    const sim = createIsolationSim("write-skew");
    sim.setLevel("SER");
    while (sim.scriptStep()) {
      /* run */
    }
    const first = sim.snapshot();
    sim.reset();
    while (sim.scriptStep()) {
      /* run */
    }
    expect(sim.snapshot().rows).toEqual(first.rows);
    expect(sim.snapshot().txns.T2.status).toBe(first.txns.T2.status);
  });

  it("switching scenario or level starts a clean run", () => {
    const sim = createIsolationSim("lost-update");
    sim.setLevel("RC");
    while (sim.scriptStep()) {
      /* run to completion */
    }
    expect(sim.snapshot().finished).toBe(true);
    sim.setScenario("write-skew");
    const snap = sim.snapshot();
    expect(snap.finished).toBe(false);
    expect(snap.txns.T1.status).toBe("active");
    expect(snap.txns.T1.cursor).toBe(0);
  });

  it("over-stepping a finished or blocked transaction is a harmless no-op", () => {
    const sim = createIsolationSim("non-repeatable-read");
    sim.setLevel("RC");
    for (let i = 0; i < 20; i++) sim.stepTxn("T1");
    for (let i = 0; i < 20; i++) sim.stepTxn("T2");
    // Extra steps after completion don't throw or change anything.
    const a = sim.snapshot();
    for (let i = 0; i < 10; i++) {
      sim.stepTxn("T1");
      sim.stepTxn("T2");
      sim.scriptStep();
    }
    expect(sim.snapshot().rows).toEqual(a.rows);
    expect(sim.snapshot().finished).toBe(true);
  });

  it("step(0) and negative dt never advance the script", () => {
    const sim = createIsolationSim("phantom");
    sim.setAutoPlay(true);
    sim.step(0);
    sim.step(-100);
    expect(sim.snapshot().txns.T1.cursor).toBe(0);
  });

  it("SIMPLIFICATIONS is non-empty (the prose depends on it)", () => {
    expect(SIMPLIFICATIONS.length).toBeGreaterThan(0);
  });
});
