import { describe, it, expect } from "vitest";
import { createQuorumSim, MAX_N, SIMPLIFICATIONS, type QuorumSim } from "./quorumSim";

function configure(sim: QuorumSim, n: number, r: number, w: number): void {
  sim.setN(n);
  sim.setR(r);
  sim.setW(w);
}

describe("the overlap guarantee: R + W > N", () => {
  it("a fresh write then read returns the latest value", () => {
    const sim = createQuorumSim();
    configure(sim, 5, 3, 3);
    const wr = sim.write();
    expect(wr.mode).toBe("strict");
    const rd = sim.read();
    expect(rd.mode).toBe("ok");
    expect(rd.fresh).toBe(true);
    expect(rd.value).toBe(wr.value);
  });

  it("you cannot manufacture a stale read when R + W > N — even partitioning the whole write set", () => {
    // For every N and every (R,W) with R+W>N: write, partition every replica that
    // took the write, then read. The read must be fresh or fail — never a stale OK.
    for (let n = 3; n <= MAX_N; n++) {
      for (let w = 1; w <= n; w++) {
        for (let r = 1; r <= n; r++) {
          if (r + w <= n) continue;
          const sim = createQuorumSim();
          configure(sim, n, r, w);
          const wr = sim.write();
          expect(wr.mode).toBe("strict");
          for (const id of wr.homeTargets) sim.togglePartition(id);
          const rd = sim.read();
          if (rd.mode === "ok") {
            expect(rd.fresh, `N=${n} R=${r} W=${w} produced a stale OK read`).toBe(true);
          } else {
            expect(rd.mode).toBe("failed"); // the read had to give up: the availability cost
          }
        }
      }
    }
  });

  it("the availability cost is explicit: partitioning the write set can make reads fail", () => {
    const sim = createQuorumSim();
    configure(sim, 3, 2, 2); // R+W=4 > 3
    const wr = sim.write(); // writes to {0,1}
    sim.togglePartition(wr.homeTargets[0]);
    sim.togglePartition(wr.homeTargets[1]);
    const rd = sim.read(); // only 1 reachable < R=2
    expect(rd.mode).toBe("failed");
  });
});

describe("the break: R + W ≤ N permits silent stale reads", () => {
  it("write, partition the write-holders, read a stale value", () => {
    const sim = createQuorumSim();
    configure(sim, 5, 2, 2); // R+W=4 ≤ 5
    expect(sim.snapshot().guaranteedOverlap).toBe(false);
    const wr = sim.write(); // {0,1} now hold v1
    expect(wr.homeTargets).toEqual([0, 1]);
    sim.togglePartition(0);
    sim.togglePartition(1);
    const rd = sim.read(); // responders {2,3} still hold v0
    expect(rd.mode).toBe("ok");
    expect(rd.fresh).toBe(false);
    expect(rd.value).toBe("v0");
    expect(sim.snapshot().committedValue).toBe("v1"); // the latest exists, the read just missed it
  });

  it("raising R+W above N closes the hole on the same partition", () => {
    const sim = createQuorumSim();
    configure(sim, 5, 3, 3);
    const wr = sim.write(); // {0,1,2}
    // partition two of the three write holders
    sim.togglePartition(wr.homeTargets[0]);
    sim.togglePartition(wr.homeTargets[1]);
    const rd = sim.read(); // reachable {2,3,4}, read {2,3,4} includes node 2 (a write holder)
    expect(rd.mode).toBe("ok");
    expect(rd.fresh).toBe(true);
  });
});

describe("strict vs sloppy quorum", () => {
  it("a strict write fails when fewer than W replicas are reachable", () => {
    const sim = createQuorumSim();
    configure(sim, 5, 2, 4);
    sim.togglePartition(0);
    sim.togglePartition(1); // 3 reachable < W=4
    const wr = sim.write();
    expect(wr.mode).toBe("failed");
    expect(sim.snapshot().committedVersion).toBe(0);
  });

  it("sloppy quorum succeeds by parking acks on stand-ins, invisible to a strict read", () => {
    const sim = createQuorumSim();
    configure(sim, 5, 2, 4);
    sim.setSloppy(true);
    sim.togglePartition(0);
    sim.togglePartition(1); // 3 home reachable, need 1 stand-in
    const wr = sim.write();
    expect(wr.mode).toBe("sloppy");
    expect(wr.standinTargets.length).toBeGreaterThan(0);
    expect(sim.snapshot().committedVersion).toBe(1);
    // a read of home replicas can still come back stale: the new value is on a stand-in
    sim.setR(2);
    // partition the home replicas that took the sloppy write so the read avoids them
    for (const id of wr.homeTargets) sim.togglePartition(id);
    const rd = sim.read();
    if (rd.mode === "ok") expect(rd.fresh).toBe(false);
  });

  it("hinted handoff delivers the parked value when the replica heals", () => {
    const sim = createQuorumSim();
    configure(sim, 5, 2, 4);
    sim.setSloppy(true);
    sim.togglePartition(0); // node 0 down → its data will be hinted to a stand-in
    sim.togglePartition(1);
    const wr = sim.write();
    expect(wr.mode).toBe("sloppy");
    const forNode = sim.snapshot().standins.find((s) => s.holding)!.holding!.forNodeId;
    sim.togglePartition(forNode); // heal it → hinted handoff fires
    const healed = sim.snapshot().home.find((h) => h.id === forNode)!;
    expect(healed.version).toBe(wr.version);
    expect(sim.snapshot().standins.every((s) => s.holding === null)).toBe(true);
  });
});

describe("read repair", () => {
  it("a read brings stale responders up to the freshest version it saw", () => {
    const sim = createQuorumSim();
    configure(sim, 5, 2, 2);
    sim.setReadRepair(true);
    sim.write(); // {0,1} -> v1
    // read a set spanning a fresh and a stale replica: partition nobody, set R=3
    sim.setR(3);
    const rd = sim.read(); // responders {0,1,2}: 0,1 have v1, 2 has v0 -> 2 repaired
    expect(rd.fresh).toBe(true);
    const node2 = sim.snapshot().home.find((h) => h.id === 2)!;
    expect(node2.version).toBe(1);
    expect(node2.repaired).toBe(true);
  });

  it("with read repair off, the stale replica stays stale", () => {
    const sim = createQuorumSim();
    configure(sim, 5, 2, 2);
    sim.setReadRepair(false);
    sim.write();
    sim.setR(3);
    sim.read();
    expect(sim.snapshot().home.find((h) => h.id === 2)!.version).toBe(0);
  });
});

describe("config clamps, reset, and abuse", () => {
  it("R and W are clamped to N; N to [3, MAX_N]", () => {
    const sim = createQuorumSim();
    sim.setN(99);
    expect(sim.snapshot().n).toBe(MAX_N);
    sim.setN(1);
    expect(sim.snapshot().n).toBe(3);
    sim.setR(99);
    expect(sim.snapshot().r).toBe(3);
    sim.setW(0);
    expect(sim.snapshot().w).toBe(1);
  });

  it("shrinking N clamps R and W down with it", () => {
    const sim = createQuorumSim();
    configure(sim, 7, 5, 5);
    sim.setN(4);
    expect(sim.snapshot().r).toBeLessThanOrEqual(4);
    expect(sim.snapshot().w).toBeLessThanOrEqual(4);
  });

  it("reading with too few replicas fails rather than lying", () => {
    const sim = createQuorumSim();
    configure(sim, 5, 4, 2);
    for (const id of [0, 1, 2, 3]) sim.togglePartition(id); // 1 reachable < R=4
    const rd = sim.read();
    expect(rd.mode).toBe("failed");
  });

  it("reset restores a clean cluster; repeated ops never throw", () => {
    const sim = createQuorumSim();
    configure(sim, 5, 2, 2);
    sim.write();
    sim.read();
    sim.togglePartition(99); // out of range, ignored
    sim.toggleStandinPartition(99);
    sim.reset();
    const snap = sim.snapshot();
    expect(snap.committedVersion).toBe(0);
    expect(snap.n).toBe(5);
    expect(snap.home.every((h) => h.reachable && h.version === 0)).toBe(true);
  });

  it("SIMPLIFICATIONS is non-empty (the prose depends on it)", () => {
    expect(SIMPLIFICATIONS.length).toBeGreaterThan(0);
  });
});
