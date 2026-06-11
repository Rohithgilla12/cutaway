import { describe, it, expect } from "vitest";
import {
  createRaftSim,
  SIMPLIFICATIONS,
  NODE_COUNT,
  QUORUM,
  ELECTION_TIMEOUT_MAX_MS,
  HEARTBEAT_INTERVAL_MS,
  type RaftSim,
  type RaftSnapshot,
  type NodeView,
} from "./raftSim";

// Reproducible op-stream generator independent of Math.random.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Op =
  | { t: "step"; dt: number }
  | { t: "kill"; i: number }
  | { t: "restart"; i: number }
  | { t: "cut"; a: number; b: number }
  | { t: "heal"; a: number; b: number }
  | { t: "partition"; groups: number[][] }
  | { t: "healAll" }
  | { t: "write" };

const PARTITION_PRESETS: number[][][] = [
  [[0, 1], [2, 3, 4]],
  [[0], [1, 2, 3, 4]],
  [[0, 1, 2], [3, 4]],
  [[0, 1], [2], [3, 4]],
];

function randomOps(seed: number, n: number): Op[] {
  const r = lcg(seed);
  const ops: Op[] = [];
  const node = (): number => Math.floor(r() * NODE_COUNT);
  for (let i = 0; i < n; i++) {
    const x = r();
    if (x < 0.45) ops.push({ t: "step", dt: 50 + Math.floor(r() * 600) });
    else if (x < 0.55) ops.push({ t: "kill", i: node() });
    else if (x < 0.65) ops.push({ t: "restart", i: node() });
    else if (x < 0.72) {
      const a = node();
      let b = node();
      if (b === a) b = (a + 1) % NODE_COUNT;
      ops.push({ t: "cut", a, b });
    } else if (x < 0.79) {
      const a = node();
      let b = node();
      if (b === a) b = (a + 1) % NODE_COUNT;
      ops.push({ t: "heal", a, b });
    } else if (x < 0.86) {
      ops.push({ t: "partition", groups: PARTITION_PRESETS[Math.floor(r() * PARTITION_PRESETS.length)] });
    } else if (x < 0.9) ops.push({ t: "healAll" });
    else ops.push({ t: "write" });
  }
  return ops;
}

function applyOp(sim: RaftSim, op: Op): void {
  switch (op.t) {
    case "step":
      sim.step(op.dt);
      break;
    case "kill":
      sim.killNode(op.i);
      break;
    case "restart":
      sim.restartNode(op.i);
      break;
    case "cut":
      sim.cutLink(op.a, op.b);
      break;
    case "heal":
      sim.healLink(op.a, op.b);
      break;
    case "partition":
      sim.partition(op.groups);
      break;
    case "healAll":
      sim.healAll();
      break;
    case "write":
      sim.clientWrite();
      break;
  }
}

function leadersInTerm(snap: RaftSnapshot): Map<number, number[]> {
  const byTerm = new Map<number, number[]>();
  for (const n of snap.nodes) {
    if (n.role === "leader") {
      const arr = byTerm.get(n.currentTerm) ?? [];
      arr.push(n.id);
      byTerm.set(n.currentTerm, arr);
    }
  }
  return byTerm;
}

// Committed-entry oracle: for a given node, the entries it considers committed.
function committedEntries(n: NodeView): { index: number; term: number; value: number }[] {
  const out: { index: number; term: number; value: number }[] = [];
  for (let i = 0; i < n.commitIndex && i < n.log.length; i++) {
    out.push({ index: i + 1, term: n.log[i].term, value: n.log[i].value });
  }
  return out;
}

describe("Election Safety: at most one leader per term (sweep)", () => {
  it("no two distinct nodes are ever leader in the same term across history", () => {
    // Track every (term -> leaderId) ever observed; a term with two distinct
    // leaders is an Election Safety violation (§5.2).
    for (let seed = 1; seed <= 60; seed++) {
      const sim = createRaftSim(seed);
      const ops = randomOps(seed, 80);
      const leaderOfTerm = new Map<number, number>();

      const check = (): void => {
        const snap = sim.snapshot();
        const byTerm = leadersInTerm(snap);
        for (const [term, ids] of byTerm) {
          // Within a single snapshot there must be at most one leader per term.
          const distinct = [...new Set(ids)];
          expect(
            distinct.length,
            `seed ${seed}: term ${term} has leaders ${distinct.join(",")}`,
          ).toBeLessThanOrEqual(1);
          const leader = distinct[0];
          const prev = leaderOfTerm.get(term);
          if (prev !== undefined) {
            expect(
              prev,
              `seed ${seed}: term ${term} had leader n${prev} then n${leader}`,
            ).toBe(leader);
          } else {
            leaderOfTerm.set(term, leader);
          }
        }
      };

      check();
      for (const op of ops) {
        applyOp(sim, op);
        check();
      }
      // Let it settle and keep checking.
      for (let k = 0; k < 40; k++) {
        sim.step(200);
        check();
      }
    }
  });
});

describe("Vote Safety: one vote per term", () => {
  it("a node never grants two different candidates the same term", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const sim = createRaftSim(seed);
      const ops = randomOps(seed, 70);
      // Map nodeId -> (term -> votedFor) observed history.
      const history = new Map<number, Map<number, number>>();

      const check = (): void => {
        const snap = sim.snapshot();
        for (const n of snap.nodes) {
          if (n.votedFor === null) continue;
          let perNode = history.get(n.id);
          if (!perNode) {
            perNode = new Map();
            history.set(n.id, perNode);
          }
          const prior = perNode.get(n.currentTerm);
          if (prior !== undefined) {
            expect(
              prior,
              `seed ${seed}: n${n.id} voted n${prior} then n${n.votedFor} in term ${n.currentTerm}`,
            ).toBe(n.votedFor);
          } else {
            perNode.set(n.currentTerm, n.votedFor);
          }
        }
      };

      check();
      for (const op of ops) {
        applyOp(sim, op);
        check();
      }
      for (let k = 0; k < 30; k++) {
        sim.step(200);
        check();
      }
    }
  });
});

describe("Split-brain refusal", () => {
  it("a leader stranded in the minority cannot commit; majority elects a new leader", () => {
    // Build a stable leader, write a committed entry, then partition the leader
    // into a minority. It must not advance commitIndex while partitioned, and the
    // majority must elect a leader in a higher term.
    for (let seed = 1; seed <= 25; seed++) {
      const sim = createRaftSim(seed);
      // Settle to a leader.
      for (let k = 0; k < 60; k++) sim.step(150);
      let snap = sim.snapshot();
      const leaders = snap.nodes.filter((n) => n.role === "leader");
      expect(leaders.length, `seed ${seed}: a leader should exist`).toBe(1);
      const oldLeader = leaders[0].id;

      // Commit a real entry first.
      sim.clientWrite();
      for (let k = 0; k < 20; k++) sim.step(150);
      snap = sim.snapshot();
      const preCommit = snap.nodes.find((n) => n.id === oldLeader)!.commitIndex;

      // Partition: old leader + one helper (minority of 2) vs the other 3.
      const others = [0, 1, 2, 3, 4].filter((i) => i !== oldLeader);
      const minority = [oldLeader, others[0]];
      const majority = others.slice(1); // 3 nodes
      sim.partition([minority, majority]);

      // Hammer writes at the (now stale) old leader while partitioned.
      for (let k = 0; k < 40; k++) {
        sim.clientWrite();
        sim.step(150);
      }

      snap = sim.snapshot();
      const oldLeaderNode = snap.nodes.find((n) => n.id === oldLeader)!;
      // It may still *claim* leadership in its stale term but cannot commit further.
      expect(
        oldLeaderNode.commitIndex,
        `seed ${seed}: stranded leader advanced commitIndex`,
      ).toBe(preCommit);

      // The majority side elects a new leader in a higher term, eventually.
      let majorityLeader: NodeView | undefined;
      for (let k = 0; k < 80; k++) {
        sim.step(150);
        snap = sim.snapshot();
        majorityLeader = snap.nodes.find(
          (n) => majority.includes(n.id) && n.role === "leader",
        );
        if (majorityLeader) break;
      }
      expect(
        majorityLeader,
        `seed ${seed}: majority failed to elect a leader`,
      ).toBeDefined();
      expect(majorityLeader!.currentTerm).toBeGreaterThan(leaders[0].currentTerm);
    }
  });
});

describe("Step-down on heal", () => {
  it("a stale leader becomes a follower within bounded time and divergent entries are overwritten", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const sim = createRaftSim(seed);
      for (let k = 0; k < 60; k++) sim.step(150);
      let snap = sim.snapshot();
      const leaders = snap.nodes.filter((n) => n.role === "leader");
      if (leaders.length !== 1) continue;
      const oldLeader = leaders[0].id;

      sim.clientWrite();
      for (let k = 0; k < 20; k++) sim.step(150);

      const others = [0, 1, 2, 3, 4].filter((i) => i !== oldLeader);
      const minority = [oldLeader, others[0]];
      const majority = others.slice(1);
      sim.partition([minority, majority]);

      // Stale leader appends entries it can never commit.
      for (let k = 0; k < 30; k++) {
        sim.clientWrite();
        sim.step(150);
      }
      // Wait for the majority to elect a new leader and commit something.
      for (let k = 0; k < 80; k++) sim.step(150);

      // Heal the partition.
      sim.healAll();

      // Within bounded time the old leader steps down.
      let steppedDown = false;
      const boundSteps = Math.ceil((ELECTION_TIMEOUT_MAX_MS * 6) / 150);
      for (let k = 0; k < boundSteps; k++) {
        sim.step(150);
        snap = sim.snapshot();
        const n = snap.nodes.find((x) => x.id === oldLeader)!;
        if (n.role !== "leader") {
          steppedDown = true;
          break;
        }
      }
      expect(steppedDown, `seed ${seed}: old leader never stepped down`).toBe(true);

      // Let logs converge.
      for (let k = 0; k < 120; k++) sim.step(150);
      snap = sim.snapshot();

      // Log Matching on the committed prefix: any two nodes agree on entries at
      // indices both consider committed.
      const alive = snap.nodes.filter((n) => n.alive);
      for (let a = 0; a < alive.length; a++) {
        for (let b = a + 1; b < alive.length; b++) {
          const na = alive[a];
          const nb = alive[b];
          const minCommit = Math.min(na.commitIndex, nb.commitIndex);
          for (let i = 0; i < minCommit; i++) {
            expect(
              na.log[i],
              `seed ${seed}: committed entry ${i + 1} differs between n${na.id} and n${nb.id}`,
            ).toEqual(nb.log[i]);
          }
        }
      }
    }
  });
});

describe("Commit Safety (State Machine Safety surrogate)", () => {
  it("no two nodes ever commit a different entry at the same index, across schedules", () => {
    // Track, globally across the whole run, the committed entry observed at each
    // index. Two different committed entries at one index is a safety violation.
    for (let seed = 1; seed <= 60; seed++) {
      const sim = createRaftSim(seed);
      const ops = randomOps(seed, 90);
      const committedAt = new Map<number, { term: number; value: number }>();

      const check = (): void => {
        const snap = sim.snapshot();
        for (const n of snap.nodes) {
          for (const e of committedEntries(n)) {
            const prior = committedAt.get(e.index);
            if (prior) {
              expect(
                prior.term === e.term && prior.value === e.value,
                `seed ${seed}: index ${e.index} committed as (t${prior.term},v${prior.value}) and (t${e.term},v${e.value})`,
              ).toBe(true);
            } else {
              committedAt.set(e.index, { term: e.term, value: e.value });
            }
          }
        }
      };

      check();
      for (const op of ops) {
        applyOp(sim, op);
        check();
      }
      for (let k = 0; k < 60; k++) {
        sim.step(200);
        check();
      }
    }
  });
});

describe("Liveness (bounded)", () => {
  it("with no partitions and all nodes alive, a leader emerges within bounded time", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const sim = createRaftSim(seed);
      let leaderEmerged = false;
      // Bound: a few election timeouts worth of stepping.
      const maxSteps = Math.ceil((ELECTION_TIMEOUT_MAX_MS * 5) / 100);
      for (let k = 0; k < maxSteps; k++) {
        sim.step(100);
        const snap = sim.snapshot();
        if (snap.nodes.some((n) => n.role === "leader")) {
          leaderEmerged = true;
          break;
        }
      }
      expect(leaderEmerged, `seed ${seed}: no leader emerged`).toBe(true);
    }
  });

  it("with 3 of 5 alive (still a quorum) a leader still emerges", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const sim = createRaftSim(seed);
      sim.killNode(3);
      sim.killNode(4);
      let leaderEmerged = false;
      const maxSteps = Math.ceil((ELECTION_TIMEOUT_MAX_MS * 6) / 100);
      for (let k = 0; k < maxSteps; k++) {
        sim.step(100);
        const snap = sim.snapshot();
        if (snap.nodes.some((n) => n.alive && n.role === "leader")) {
          leaderEmerged = true;
          break;
        }
      }
      expect(leaderEmerged, `seed ${seed}: no leader with 3/5 alive`).toBe(true);
    }
  });

  it("with only 2 of 5 alive (no quorum) NO leader is ever committed-stable", () => {
    // Sanity: a 2-node minority cannot elect a stable leader (no quorum).
    const sim = createRaftSim(7);
    sim.killNode(2);
    sim.killNode(3);
    sim.killNode(4);
    for (let k = 0; k < 80; k++) sim.step(150);
    const snap = sim.snapshot();
    // Candidates may exist but none can win 3 votes.
    expect(snap.nodes.every((n) => n.role !== "leader")).toBe(true);
  });
});

describe("Determinism", () => {
  it("same seed + same call sequence => JSON-identical snapshots at every step", () => {
    const seed = 123;
    const ops = randomOps(seed, 120);
    const a = createRaftSim(seed);
    const b = createRaftSim(seed);
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    for (const op of ops) {
      applyOp(a, op);
      applyOp(b, op);
      expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    }
  });

  it("reset restores the deterministic initial snapshot", () => {
    const a = createRaftSim(55);
    const fresh = JSON.stringify(a.snapshot());
    for (let k = 0; k < 50; k++) {
      a.step(123);
      a.clientWrite();
    }
    a.killNode(1);
    a.partition([[0, 1], [2, 3, 4]]);
    a.reset();
    expect(JSON.stringify(a.snapshot())).toBe(fresh);
  });
});

describe("Spam safety: all methods in all states", () => {
  it("structural invariants hold under arbitrary method spam", () => {
    const sim = createRaftSim(31);
    const r = lcg(999);
    const spam = (): void => {
      sim.step(1 + Math.floor(r() * 700));
      sim.killNode(Math.floor(r() * NODE_COUNT));
      sim.restartNode(Math.floor(r() * NODE_COUNT));
      sim.cutLink(0, 1);
      sim.healLink(0, 1);
      sim.partition([[0, 1], [2, 3, 4]]);
      sim.healAll();
      sim.clientWrite();
    };

    for (let i = 0; i < 2000; i++) {
      expect(() => spam()).not.toThrow();
      const snap = sim.snapshot();
      expect(snap.nodes.length).toBe(NODE_COUNT);
      expect(snap.links.length).toBe((NODE_COUNT * (NODE_COUNT - 1)) / 2);
      for (const n of snap.nodes) {
        // commitIndex never exceeds log length.
        expect(n.commitIndex).toBeLessThanOrEqual(n.log.length);
        expect(n.commitIndex).toBeGreaterThanOrEqual(0);
        expect(n.currentTerm).toBeGreaterThanOrEqual(0);
        // committedValues length matches commitIndex (bounded by log length).
        expect(n.committedValues.length).toBe(Math.min(n.commitIndex, n.log.length));
        // votedFor is a valid node id or null.
        if (n.votedFor !== null) {
          expect(n.votedFor).toBeGreaterThanOrEqual(0);
          expect(n.votedFor).toBeLessThan(NODE_COUNT);
        }
        // timerPct in [0,1].
        expect(n.timerPct).toBeGreaterThanOrEqual(0);
        expect(n.timerPct).toBeLessThanOrEqual(1);
        // dead nodes carry the dead role; alive nodes do not.
        expect(n.alive ? n.role !== "dead" : n.role === "dead").toBe(true);
      }
      for (const m of snap.messages) {
        expect(m.progress).toBeGreaterThanOrEqual(0);
        expect(m.progress).toBeLessThanOrEqual(1);
      }
    }
  });

  it("terms are monotonic per node under spam (never decrease)", () => {
    const sim = createRaftSim(17);
    const r = lcg(444);
    const lastTerm = new Array(NODE_COUNT).fill(0);
    for (let i = 0; i < 1500; i++) {
      const x = r();
      if (x < 0.5) sim.step(1 + Math.floor(r() * 500));
      else if (x < 0.6) sim.killNode(Math.floor(r() * NODE_COUNT));
      else if (x < 0.7) sim.restartNode(Math.floor(r() * NODE_COUNT));
      else if (x < 0.8) sim.partition([[0], [1, 2], [3, 4]]);
      else if (x < 0.9) sim.healAll();
      else sim.clientWrite();
      const snap = sim.snapshot();
      for (const n of snap.nodes) {
        expect(n.currentTerm, `n${n.id} term went backwards`).toBeGreaterThanOrEqual(
          lastTerm[n.id],
        );
        lastTerm[n.id] = n.currentTerm;
      }
    }
  });

  it("every method is a safe no-op on out-of-range / meaningless input", () => {
    const sim = createRaftSim(3);
    expect(() => {
      sim.step(0);
      sim.step(-100);
      sim.killNode(-1);
      sim.killNode(99);
      sim.restartNode(2); // alive node: no-op
      sim.cutLink(2, 2); // self-link: no-op
      sim.cutLink(0, 9); // out of range
      sim.healLink(0, 1); // not cut: no-op
      sim.partition([]); // empty
      sim.partition([[0, 1, 2, 3, 4]]); // single group
      sim.healAll(); // nothing down
      sim.clientWrite(); // no leader yet
    }).not.toThrow();
    const snap = sim.snapshot();
    expect(snap.nodes.length).toBe(NODE_COUNT);
  });
});

describe("Vote restriction (§5.4.1)", () => {
  it("a node isolated with a stale short log can never win the cluster's leadership", () => {
    // Build a leader and commit several entries, so a quorum of nodes hold a long,
    // up-to-date log. Then isolate node `behind` BEFORE those commits so it stays
    // short, and let it spin as a candidate. The up-to-date quorum must reject it:
    // it can never become leader of the full cluster on heal because its log is
    // strictly less up-to-date than a quorum (§5.4.1).
    for (let seed = 1; seed <= 20; seed++) {
      const sim = createRaftSim(seed);
      for (let k = 0; k < 60; k++) sim.step(150);
      let snap = sim.snapshot();
      const leader = snap.nodes.find((n) => n.role === "leader");
      if (!leader) continue;

      // Pick a follower to strand BEFORE we commit more entries.
      const behind = snap.nodes.find((n) => n.id !== leader.id)!.id;
      const rest = [0, 1, 2, 3, 4].filter((i) => i !== behind);
      sim.partition([[behind], rest]); // isolate the behind node

      // Commit entries on the majority side; behind node misses all of them.
      for (let w = 0; w < 6; w++) {
        sim.clientWrite();
        for (let k = 0; k < 10; k++) sim.step(150);
      }
      snap = sim.snapshot();
      const behindLen = snap.nodes.find((n) => n.id === behind)!.log.length;
      const majorityMaxLen = Math.max(
        ...snap.nodes.filter((n) => n.id !== behind).map((n) => n.log.length),
      );
      // Precondition: behind really is behind.
      expect(majorityMaxLen).toBeGreaterThan(behindLen);

      // Heal and let everything settle. The behind node may have bumped its term
      // high while spinning alone, forcing a re-election — but it must never end
      // up as the leader, because the up-to-date quorum will not vote for it.
      sim.healAll();
      for (let k = 0; k < 120; k++) {
        sim.step(150);
        const s = sim.snapshot();
        const bn = s.nodes.find((n) => n.id === behind)!;
        // The instant we observe it as leader would be a §5.4.1 violation IF its
        // log is still shorter than the committed prefix. Once it catches up via
        // AppendEntries it is allowed to lead, so we assert the real safety net:
        // it cannot lead while still missing committed entries.
        if (bn.role === "leader") {
          expect(
            bn.log.length,
            `seed ${seed}: behind node n${behind} became leader with a short log`,
          ).toBeGreaterThanOrEqual(majorityMaxLen);
        }
      }
    }
  });
});

describe("metadata", () => {
  it("exports useful constants and a non-empty SIMPLIFICATIONS list", () => {
    expect(NODE_COUNT).toBe(5);
    expect(QUORUM).toBe(3);
    expect(HEARTBEAT_INTERVAL_MS).toBeGreaterThan(0);
    expect(Array.isArray(SIMPLIFICATIONS)).toBe(true);
    expect(SIMPLIFICATIONS.length).toBeGreaterThan(3);
    expect(SIMPLIFICATIONS.every((s) => typeof s === "string" && s.length > 0)).toBe(true);
  });
});
