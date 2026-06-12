import { describe, it, expect } from "vitest";
import {
  createMvccSim,
  ROW_COUNT,
  PAGE_CAPACITY,
  DISK_PAGE_CAP,
  BOOTSTRAP_XID,
  AUTO_UPDATE_INTERVAL_MS,
  AUTOVACUUM_NAPTIME_MS,
  SIMPLIFICATIONS,
  type MvccSim,
  type MvccSnapshot,
} from "./mvccSim";

// Deterministic test RNG, independent of the sim's RNG.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Oracle for the user-visible contract: the latest committed version of each
// row, maintained by counting this test's own updates.
class Oracle {
  versions: number[] = new Array(ROW_COUNT).fill(1);
  update(rowId: number): void {
    this.versions[rowId] += 1;
  }
}

function tuples(snap: MvccSnapshot) {
  return snap.pages.flatMap((p) => p.slots.filter((t) => t !== null));
}

function assertCoreInvariants(snap: MvccSnapshot, oracle: Oracle): void {
  // Exactly one live tuple per row, matching the oracle's latest version.
  for (let r = 0; r < ROW_COUNT; r++) {
    const live = tuples(snap).filter((t) => t.rowId === r && t.xmax === 0);
    expect(live.length, `row ${r} live tuple count`).toBe(1);
    expect(live[0].version, `row ${r} latest version`).toBe(oracle.versions[r]);
    expect(snap.rows[r].latestVersion).toBe(oracle.versions[r]);
  }
  // Counters agree with the heap.
  expect(snap.liveCount).toBe(ROW_COUNT);
  expect(snap.deadTotal).toBe(snap.deadRemovable + snap.deadPinned);
  expect(snap.deadTotal).toBe(tuples(snap).filter((t) => t.xmax !== 0).length);
  // Bloat is defined as pages on disk over pages the live data needs.
  expect(snap.bloatRatio).toBeCloseTo(snap.pageCount / snap.minPagesNeeded, 10);
  expect(snap.minPagesNeeded).toBe(Math.max(1, Math.ceil(snap.liveCount / PAGE_CAPACITY)));
  // Horizon definition.
  expect(snap.horizonXid).toBe(snap.longTxn ? snap.longTxn.snapshotXmin : snap.nextXid);
}

describe("update mechanics", () => {
  it("an UPDATE creates a new version and marks exactly the old one dead", () => {
    const sim = createMvccSim(1);
    const before = sim.snapshot();
    expect(before.deadTotal).toBe(0);
    expect(before.pageCount).toBe(ROW_COUNT / PAGE_CAPACITY);

    sim.update(3);
    const after = sim.snapshot();
    expect(after.deadTotal).toBe(1);
    const dead = tuples(after).find((t) => t.xmax !== 0)!;
    expect(dead.rowId).toBe(3);
    expect(dead.version).toBe(1);
    expect(dead.xmin).toBe(BOOTSTRAP_XID);
    const live = tuples(after).find((t) => t.rowId === 3 && t.xmax === 0)!;
    expect(live.version).toBe(2);
    expect(live.xmin).toBe(dead.xmax);
  });

  it("random schedules preserve the core invariants at every point", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const sim = createMvccSim(seed);
      const oracle = new Oracle();
      const r = lcg(seed);
      for (let i = 0; i < 80; i++) {
        const x = r();
        if (x < 0.6) {
          const row = Math.floor(r() * ROW_COUNT);
          if (sim.update(row)) oracle.update(row);
        } else if (x < 0.75) {
          sim.vacuum();
        } else if (x < 0.85) {
          sim.openLongTxn();
        } else {
          sim.closeLongTxn();
        }
        assertCoreInvariants(sim.snapshot(), oracle);
      }
    }
  });
});

describe("snapshot visibility (the reason versions are kept)", () => {
  it("the held snapshot sees the versions current at open, frozen across updates and vacuums", () => {
    const sim = createMvccSim(7);
    sim.update(0);
    sim.update(0);
    sim.openLongTxn();
    const atOpen = sim.snapshot().rows.map((r) => r.snapshotVersion);
    expect(atOpen[0]).toBe(3);
    expect(atOpen.slice(1)).toEqual(new Array(ROW_COUNT - 1).fill(1));

    const r = lcg(99);
    for (let i = 0; i < 60; i++) {
      sim.update(Math.floor(r() * ROW_COUNT));
      if (i % 7 === 0) sim.vacuum();
      const rows = sim.snapshot().rows;
      expect(rows.map((x) => x.snapshotVersion)).toEqual(atOpen);
    }
  });

  it("exactly one version per row is visible to the held snapshot", () => {
    const sim = createMvccSim(11);
    sim.openLongTxn();
    const r = lcg(5);
    for (let i = 0; i < 40; i++) sim.update(Math.floor(r() * ROW_COUNT));
    const snap = sim.snapshot();
    for (let row = 0; row < ROW_COUNT; row++) {
      const visible = tuples(snap).filter((t) => t.rowId === row && t.visibleToSnapshot);
      expect(visible.length).toBe(1);
    }
  });

  it("no tuple reports snapshot visibility when no transaction is held", () => {
    const sim = createMvccSim(2);
    sim.update();
    const snap = sim.snapshot();
    expect(tuples(snap).every((t) => !t.visibleToSnapshot)).toBe(true);
    expect(snap.rows.every((r) => r.snapshotVersion === null)).toBe(true);
  });
});

describe("vacuum and the horizon", () => {
  it("with no snapshot held, vacuum removes every dead tuple", () => {
    const sim = createMvccSim(3);
    const r = lcg(3);
    for (let i = 0; i < 25; i++) sim.update(Math.floor(r() * ROW_COUNT));
    expect(sim.snapshot().deadTotal).toBe(25);
    sim.vacuum();
    const snap = sim.snapshot();
    expect(snap.deadTotal).toBe(0);
    expect(snap.lastVacuum!.removed).toBe(25);
    expect(snap.lastVacuum!.kept).toBe(0);
  });

  it("vacuum never removes a tuple the held snapshot can see, and reports the kept count", () => {
    const sim = createMvccSim(4);
    sim.update(0); // dead BEFORE the snapshot opens: removable even while held
    sim.openLongTxn();
    const r = lcg(8);
    for (let i = 0; i < 20; i++) sim.update(Math.floor(r() * ROW_COUNT));

    const before = sim.snapshot();
    expect(before.deadRemovable).toBe(1);
    expect(before.deadPinned).toBe(20);
    const visibleBefore = before.rows.map((x) => x.snapshotVersion);

    sim.vacuum();
    const after = sim.snapshot();
    expect(after.lastVacuum!.removed).toBe(1);
    expect(after.lastVacuum!.kept).toBe(20);
    expect(after.lastVacuum!.oldestXmin).toBe(before.longTxn!.snapshotXmin);
    expect(after.deadTotal).toBe(20);
    // Every survivor's deleter is at or above the horizon.
    for (const t of tuples(after)) {
      if (t.xmax !== 0) expect(t.xmax).toBeGreaterThanOrEqual(after.horizonXid);
    }
    // The snapshot's view is untouched.
    expect(after.rows.map((x) => x.snapshotVersion)).toEqual(visibleBefore);
  });

  it("a version deleted at the exact horizon xid is pinned (boundary)", () => {
    const sim = createMvccSim(5);
    sim.openLongTxn();
    const s = sim.snapshot().longTxn!.snapshotXmin;
    sim.update(0); // this update's xid == s, so old version has xmax == s
    sim.vacuum();
    const snap = sim.snapshot();
    expect(snap.lastVacuum!.kept).toBe(1);
    const dead = tuples(snap).find((t) => t.xmax !== 0)!;
    expect(dead.xmax).toBe(s);
    expect(dead.fate).toBe("dead-pinned");
    expect(dead.visibleToSnapshot).toBe(true);
  });

  it("committing the long transaction makes the pinned tuples removable", () => {
    const sim = createMvccSim(6);
    sim.openLongTxn();
    const r = lcg(13);
    for (let i = 0; i < 15; i++) sim.update(Math.floor(r() * ROW_COUNT));
    sim.vacuum();
    expect(sim.snapshot().deadTotal).toBe(15);
    sim.closeLongTxn();
    expect(sim.snapshot().deadRemovable).toBe(15);
    sim.vacuum();
    expect(sim.snapshot().deadTotal).toBe(0);
  });

  it("horizon age grows while the transaction is held and collapses on commit", () => {
    const sim = createMvccSim(9);
    sim.openLongTxn();
    for (let i = 0; i < 30; i++) sim.update(i % ROW_COUNT);
    const held = sim.snapshot();
    expect(held.horizonAgeXids).toBe(30);
    expect(held.longTxn!.heldForXids).toBe(30);
    sim.closeLongTxn();
    expect(sim.snapshot().horizonAgeXids).toBe(0);
  });
});

describe("space reuse and the high-water mark", () => {
  it("vacuumed space is reused: a sustained update+vacuum loop never grows the table", () => {
    const sim = createMvccSim(10);
    const r = lcg(21);
    let maxPages = 0;
    for (let i = 0; i < 200; i++) {
      sim.update(Math.floor(r() * ROW_COUNT));
      sim.vacuum();
      maxPages = Math.max(maxPages, sim.snapshot().pageCount);
    }
    // 8 live + at most 1 dead between vacuums = 9 tuples -> 3 pages.
    expect(maxPages).toBeLessThanOrEqual(3);
  });

  it("interior free space does not shrink the file; only trailing empty pages truncate", () => {
    const sim = createMvccSim(12);
    sim.openLongTxn();
    const r = lcg(31);
    for (let i = 0; i < 40; i++) sim.update(Math.floor(r() * ROW_COUNT));
    const bloated = sim.snapshot().pageCount;
    expect(bloated).toBeGreaterThan(ROW_COUNT / PAGE_CAPACITY);
    sim.closeLongTxn();
    sim.vacuum();
    const after = sim.snapshot();
    // Dead tuples are gone but live ones are scattered: the file keeps every
    // page up to the last one that still holds a live tuple.
    expect(after.deadTotal).toBe(0);
    let lastLivePage = 0;
    after.pages.forEach((p, i) => {
      if (p.slots.some((t) => t !== null)) lastLivePage = i;
    });
    expect(after.pageCount).toBe(lastLivePage + 1);
    expect(after.pageCount + after.lastVacuum!.truncatedPages).toBe(bloated);
  });

  it("a pinned horizon under load drives the table to the disk cap and updates are refused", () => {
    const sim = createMvccSim(13);
    sim.openLongTxn();
    let refused = 0;
    for (let i = 0; i < DISK_PAGE_CAP * PAGE_CAPACITY + 20; i++) {
      if (!sim.update(i % ROW_COUNT)) refused += 1;
    }
    const snap = sim.snapshot();
    expect(refused).toBeGreaterThan(0);
    expect(snap.diskFull).toBe(true);
    expect(snap.pageCount).toBe(DISK_PAGE_CAP);
    expect(snap.freeSlots).toBe(0);
    // Vacuum while pinned reclaims nothing (only the pre-snapshot bootstrap
    // versions were removable, and none are: every dead xmax >= snapshot).
    sim.vacuum();
    expect(sim.snapshot().diskFull).toBe(true);
    // Release and vacuum: space comes back, updates succeed again.
    sim.closeLongTxn();
    sim.vacuum();
    expect(sim.snapshot().diskFull).toBe(false);
    expect(sim.update(0)).toBe(true);
  });
});

describe("auto drivers", () => {
  it("auto-update fires on its interval through step()", () => {
    const sim = createMvccSim(14);
    sim.setAutoUpdate(true);
    sim.step(AUTO_UPDATE_INTERVAL_MS * 4);
    expect(sim.snapshot().totalUpdates).toBe(4);
    sim.setAutoUpdate(false);
    sim.step(AUTO_UPDATE_INTERVAL_MS * 10);
    expect(sim.snapshot().totalUpdates).toBe(4);
  });

  it("autovacuum fires at naptime only once dead tuples reach the threshold", () => {
    const sim = createMvccSim(15);
    sim.setAutoVacuum(true);
    const threshold = sim.snapshot().autovacuumThreshold;
    for (let i = 0; i < threshold - 1; i++) sim.update(i % ROW_COUNT);
    sim.step(AUTOVACUUM_NAPTIME_MS);
    expect(sim.snapshot().lastVacuum).toBeNull(); // below threshold: no run
    sim.update(0);
    expect(sim.snapshot().deadTotal).toBe(threshold);
    sim.step(AUTOVACUUM_NAPTIME_MS);
    const snap = sim.snapshot();
    expect(snap.lastVacuum).not.toBeNull();
    expect(snap.lastVacuum!.trigger).toBe("auto");
    expect(snap.deadTotal).toBe(0);
  });
});

describe("determinism and abuse", () => {
  function drive(sim: MvccSim): MvccSnapshot {
    sim.setAutoUpdate(true);
    sim.step(3000);
    sim.openLongTxn();
    sim.step(2500);
    sim.vacuum();
    sim.step(1000);
    return sim.snapshot();
  }

  it("same seed, same schedule, same snapshot", () => {
    const a = drive(createMvccSim(42));
    const b = drive(createMvccSim(42));
    expect(a).toEqual(b);
  });

  it("reset reproduces the initial state exactly, including the RNG trajectory", () => {
    const fresh = drive(createMvccSim(42));
    const reset = createMvccSim(42);
    drive(reset);
    reset.reset();
    expect(reset.snapshot()).toEqual(createMvccSim(42).snapshot());
    expect(drive(reset)).toEqual(fresh);
  });

  it("no-op events never throw or corrupt: double open, close with none, vacuum on clean table", () => {
    const sim = createMvccSim(16);
    sim.vacuum();
    expect(sim.snapshot().lastVacuum!.removed).toBe(0);
    sim.closeLongTxn();
    sim.openLongTxn();
    const s1 = sim.snapshot().longTxn!.snapshotXmin;
    sim.update(0);
    sim.openLongTxn(); // no-op: snapshot unchanged
    expect(sim.snapshot().longTxn!.snapshotXmin).toBe(s1);
    sim.closeLongTxn();
    sim.closeLongTxn();
    expect(sim.snapshot().longTxn).toBeNull();
    sim.step(0);
    sim.step(-50);
    const oracle = new Oracle();
    oracle.update(0);
    assertCoreInvariants(sim.snapshot(), oracle);
  });

  it("SIMPLIFICATIONS is non-empty (the prose depends on it)", () => {
    expect(SIMPLIFICATIONS.length).toBeGreaterThan(0);
  });
});
