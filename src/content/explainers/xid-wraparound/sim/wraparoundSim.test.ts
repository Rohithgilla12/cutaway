import { describe, it, expect } from "vitest";
import {
  createWraparoundSim,
  WRAP_SPACE,
  FREEZE_MAX_AGE,
  FREEZE_MIN_AGE,
  AGE_WARN,
  AGE_REFUSE,
  BOOTSTRAP_NEXTXID,
  BOOTSTRAP_RELFROZEN,
  SIMPLIFICATIONS,
  type WraparoundSim,
  type WraparoundSnapshot,
} from "./wraparoundSim";

function ageInvariant(snap: WraparoundSnapshot): void {
  expect(snap.age).toBe(snap.nextXid - snap.relfrozenXid);
  expect(snap.remaining).toBe(WRAP_SPACE - snap.age);
  expect(snap.oldestXmin).toBe(snap.pinnedXmin ?? snap.nextXid);
}

describe("healthy steady state", () => {
  it("starts at age = vacuum_freeze_min_age", () => {
    const snap = createWraparoundSim().snapshot();
    expect(snap.age).toBe(FREEZE_MIN_AGE);
    expect(snap.status).toBe("healthy");
    ageInvariant(snap);
  });

  it("an unpinned freeze pulls age down to vacuum_freeze_min_age", () => {
    const sim = createWraparoundSim();
    sim.burnXids(120);
    expect(sim.snapshot().age).toBe(FREEZE_MIN_AGE + 120);
    sim.freeze();
    const snap = sim.snapshot();
    expect(snap.age).toBe(FREEZE_MIN_AGE);
    expect(snap.lastFreeze!.stuck).toBe(false);
    ageInvariant(snap);
  });

  it("a forced anti-wraparound vacuum fires at autovacuum_freeze_max_age even with autovacuum off", () => {
    const sim = createWraparoundSim();
    sim.setAutoVacuum(false);
    sim.burnXids(FREEZE_MAX_AGE); // pushes age to FREEZE_MIN_AGE + 200, well past the force line
    expect(sim.snapshot().status).not.toBe("healthy");
    sim.step(1); // a single tick: the forced vacuum runs
    const snap = sim.snapshot();
    expect(snap.age).toBe(FREEZE_MIN_AGE);
    expect(snap.status).toBe("healthy");
    expect(snap.lastFreeze!.trigger).toBe("auto-forced");
  });
});

describe("a pinned snapshot defeats freezing", () => {
  it("freeze cannot advance relfrozenxid past the pinned horizon", () => {
    const sim = createWraparoundSim();
    sim.pinSnapshot();
    const pinned = sim.snapshot().pinnedXmin!;
    sim.burnXids(400);
    sim.freeze();
    const snap = sim.snapshot();
    // relfrozenxid is clamped at the pinned xmin; age = nextXid - pinned.
    expect(snap.relfrozenXid).toBe(pinned);
    expect(snap.age).toBe(snap.nextXid - pinned);
    expect(snap.lastFreeze!.stuck).toBe(true);
    ageInvariant(snap);
  });

  it("age grows monotonically with every burn while pinned, freeze or not", () => {
    const sim = createWraparoundSim();
    sim.pinSnapshot();
    // First burn+freeze settles relfrozenxid at the pinned horizon (it can still
    // claw back the pre-pin slack). After that, freezing is powerless.
    sim.burnXids(50);
    sim.freeze();
    let prev = sim.snapshot().age;
    for (let i = 0; i < 20; i++) {
      sim.burnXids(50);
      sim.freeze(); // changes nothing once stuck at the horizon
      const a = sim.snapshot().age;
      expect(a).toBeGreaterThan(prev);
      prev = a;
    }
  });

  it("even the forced vacuum cannot rescue a pinned cluster", () => {
    const sim = createWraparoundSim();
    sim.pinSnapshot();
    const pinned = sim.snapshot().pinnedXmin!;
    sim.burnXids(2200); // straight past the refuse line
    expect(sim.snapshot().status).toBe("refusing");
    sim.step(1); // forced vacuum runs…
    const snap = sim.snapshot();
    expect(snap.relfrozenXid).toBe(pinned); // …and is stuck at the horizon
    expect(snap.status).toBe("refusing");
  });
});

describe("the wraparound walls", () => {
  it("crosses forcing → warning → refusing at the documented ages", () => {
    const sim = createWraparoundSim();
    // No pin and no step() means no freeze ever runs, so relfrozenxid stays put
    // and age = nextXid - relfrozenxid is driven purely by burns.
    const burnToAge = (target: number) => {
      const want = BOOTSTRAP_RELFROZEN + target;
      const cur = sim.snapshot().nextXid;
      if (want > cur) sim.burnXids(want - cur);
    };

    burnToAge(FREEZE_MAX_AGE - 1);
    expect(sim.snapshot().status).toBe("healthy");
    burnToAge(FREEZE_MAX_AGE);
    expect(sim.snapshot().status).toBe("forcing");
    burnToAge(AGE_WARN);
    expect(sim.snapshot().status).toBe("warning");
    burnToAge(AGE_REFUSE);
    expect(sim.snapshot().status).toBe("refusing");
  });

  it("refusing halts xid consumption", () => {
    const sim = createWraparoundSim();
    sim.pinSnapshot();
    sim.burnXids(2200);
    expect(sim.snapshot().status).toBe("refusing");
    const frozenNext = sim.snapshot().nextXid;
    sim.burnXids(100); // refused
    expect(sim.snapshot().nextXid).toBe(frozenNext);
  });

  it("releasing the snapshot and freezing recovers from a full outage", () => {
    const sim = createWraparoundSim();
    sim.pinSnapshot();
    sim.burnXids(2200);
    expect(sim.snapshot().status).toBe("refusing");
    sim.releaseSnapshot();
    expect(sim.snapshot().status).toBe("refusing"); // release alone does nothing until vacuum runs
    sim.freeze();
    const snap = sim.snapshot();
    expect(snap.status).toBe("healthy");
    expect(snap.age).toBe(FREEZE_MIN_AGE);
    expect(snap.pinnedXmin).toBeNull();
    // and writes resume
    sim.burnXids(10);
    expect(sim.snapshot().nextXid).toBe(snap.nextXid + 10);
  });
});

describe("workload-driven climb", () => {
  it("workload + pinned horizon drives the cluster to refusing over time", () => {
    const sim = createWraparoundSim();
    sim.pinSnapshot();
    sim.setWorkload(true);
    let guard = 100000;
    while (sim.snapshot().status !== "refusing" && guard-- > 0) sim.step(100);
    expect(sim.snapshot().status).toBe("refusing");
  });

  it("workload + autovacuum without a pin holds a healthy steady state", () => {
    const sim = createWraparoundSim();
    sim.setAutoVacuum(true);
    sim.setWorkload(true);
    let maxAge = 0;
    for (let i = 0; i < 400; i++) {
      sim.step(100);
      maxAge = Math.max(maxAge, sim.snapshot().age);
    }
    // Forced/auto vacuum keeps age bounded; it never approaches the walls.
    expect(maxAge).toBeLessThan(FREEZE_MAX_AGE + 50);
    expect(sim.snapshot().status).not.toBe("refusing");
  });
});

describe("determinism and abuse", () => {
  function drive(sim: WraparoundSim): WraparoundSnapshot {
    sim.setWorkload(true);
    sim.step(2000);
    sim.pinSnapshot();
    sim.step(3000);
    sim.freeze();
    sim.releaseSnapshot();
    sim.step(1000);
    return sim.snapshot();
  }

  it("same schedule yields the same snapshot", () => {
    expect(drive(createWraparoundSim())).toEqual(drive(createWraparoundSim()));
  });

  it("reset reproduces the initial state", () => {
    const sim = createWraparoundSim();
    drive(sim);
    sim.reset();
    expect(sim.snapshot()).toEqual(createWraparoundSim().snapshot());
    expect(sim.snapshot().nextXid).toBe(BOOTSTRAP_NEXTXID);
    expect(sim.snapshot().relfrozenXid).toBe(BOOTSTRAP_RELFROZEN);
  });

  it("no-op events never throw or corrupt", () => {
    const sim = createWraparoundSim();
    sim.releaseSnapshot(); // none held
    sim.pinSnapshot();
    const x = sim.snapshot().pinnedXmin;
    sim.pinSnapshot(); // already pinned: no change
    expect(sim.snapshot().pinnedXmin).toBe(x);
    sim.freeze();
    sim.step(0);
    sim.step(-100);
    sim.burnXids(0);
    sim.burnXids(-50);
    ageInvariant(sim.snapshot());
    expect(sim.snapshot().nextXid).toBe(BOOTSTRAP_NEXTXID);
  });

  it("SIMPLIFICATIONS is non-empty (the prose depends on it)", () => {
    expect(SIMPLIFICATIONS.length).toBeGreaterThan(0);
  });
});
