import { describe, it, expect } from "vitest";
import {
  createBtreeSim,
  LEAF_CAP,
  INTERNAL_CAP,
  MAX_KEYS,
  SIMPLIFICATIONS,
  type BtreeSim,
  type BtreeSnapshot,
  type TreeNodeView,
} from "./btreeSim";

function leafDepths(node: TreeNodeView, depth = 0, acc: number[] = []): number[] {
  if (node.leaf) acc.push(depth);
  else node.children!.forEach((c) => leafDepths(c, depth + 1, acc));
  return acc;
}

function maxKeysOk(node: TreeNodeView): boolean {
  if (node.leaf) return node.keys.length <= LEAF_CAP;
  if (node.children!.length > INTERNAL_CAP) return false;
  // internal separators = children - 1
  if (node.keys.length !== node.children!.length - 1) return false;
  return node.children!.every(maxKeysOk);
}

// The structural invariants every B+tree must hold, checked after every op.
function assertTreeValid(sim: BtreeSim, oracle: Set<number>): void {
  const snap = sim.snapshot();
  // 1. in-order leaf traversal yields the sorted set of live keys
  expect(sim.keysInOrder()).toEqual([...oracle].sort((a, b) => a - b));
  // 2. all leaves at the same depth
  const depths = leafDepths(snap.root);
  expect(new Set(depths).size).toBe(1);
  // 3. height matches leaf depth + 1
  expect(snap.height).toBe(depths[0] + 1);
  // 4. no page exceeds capacity; separators consistent
  expect(maxKeysOk(snap.root)).toBe(true);
  // 5. search agrees with membership
  for (const k of oracle) expect(sim.has(k)).toBe(true);
}

describe("structural invariants", () => {
  it("sequential inserts keep a valid B+tree and grow height", () => {
    const sim = createBtreeSim(1);
    const oracle = new Set<number>();
    sim.setMode("sequential");
    for (let i = 0; i < 40; i++) {
      const before = sim.snapshot().totalKeys;
      sim.insert();
      // recover which key was inserted from the in-order list delta
      const keys = sim.keysInOrder();
      keys.forEach((k) => oracle.add(k));
      expect(sim.snapshot().totalKeys).toBe(before + 1);
      assertTreeValid(sim, oracle);
    }
    expect(sim.snapshot().height).toBeGreaterThanOrEqual(3);
  });

  it("random inserts keep a valid B+tree across many seeds", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const sim = createBtreeSim(seed);
      sim.setMode("random");
      const oracle = new Set<number>();
      for (let i = 0; i < 45; i++) {
        sim.insert();
        sim.keysInOrder().forEach((k) => oracle.add(k));
        // prune oracle to exactly the live set (no deletes here, so equal)
        assertTreeValid(sim, oracle);
      }
    }
  });

  it("explicit key inserts are idempotent (unique index)", () => {
    const sim = createBtreeSim(3);
    expect(sim.insertKey(500)).toBe(true);
    expect(sim.insertKey(500)).toBe(true); // returns true but is a no-op insert
    expect(sim.keysInOrder().filter((k) => k === 500).length).toBe(1);
  });
});

describe("the packing story: sequential vs random", () => {
  function fillAfter(mode: "sequential" | "random", seed: number, n: number): BtreeSnapshot {
    const sim = createBtreeSim(seed);
    sim.setMode(mode);
    for (let i = 0; i < n; i++) sim.insert();
    return sim.snapshot();
  }

  it("sequential inserts split ONLY at the rightmost leaf", () => {
    const snap = fillAfter("sequential", 1, 40);
    expect(snap.interiorSplits).toBe(0);
    expect(snap.rightmostSplits).toBeGreaterThan(0);
  });

  it("random inserts force interior 50/50 splits", () => {
    const snap = fillAfter("random", 7, 40);
    expect(snap.interiorSplits).toBeGreaterThan(0);
  });

  it("sequential packs denser than random (fillfactor vs ~half-full pages)", () => {
    // Average over seeds to avoid a lucky/unlucky random run.
    const seq = fillAfter("sequential", 1, 45).fillPct;
    let randSum = 0;
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    for (const s of seeds) randSum += fillAfter("random", s, 45).fillPct;
    const randAvg = randSum / seeds.length;
    expect(seq).toBeGreaterThan(randAvg);
    expect(seq).toBeGreaterThan(80); // dense
    expect(randAvg).toBeLessThan(80); // looser
  });

  it("random inserts cause more splits per insert than sequential", () => {
    const seq = fillAfter("sequential", 1, 45).splitsPerInsert;
    let randSum = 0;
    const seeds = [1, 2, 3, 4, 5, 6];
    for (const s of seeds) randSum += fillAfter("random", s, 45).splitsPerInsert;
    expect(randSum / seeds.length).toBeGreaterThan(seq);
  });

  it("a lower fillfactor leaves the rightmost-split pages looser", () => {
    const dense = createBtreeSim(1);
    dense.setMode("sequential");
    dense.setFillfactor(90);
    for (let i = 0; i < 45; i++) dense.insert();

    const loose = createBtreeSim(1);
    loose.setMode("sequential");
    loose.setFillfactor(50);
    for (let i = 0; i < 45; i++) loose.insert();

    expect(loose.snapshot().fillPct).toBeLessThan(dense.snapshot().fillPct);
  });
});

describe("deletes do not reclaim partially-full pages", () => {
  it("deleting most keys leaves underfull leaves behind", () => {
    const sim = createBtreeSim(2);
    sim.setMode("sequential");
    for (let i = 0; i < 40; i++) sim.insert();
    const beforeLeaves = sim.snapshot().leafCount;
    const keys = sim.keysInOrder();
    // delete every other key — empties nothing fully, just thins pages
    for (let i = 0; i < keys.length; i += 2) sim.deleteKey(keys[i]);
    const after = sim.snapshot();
    // leaf count barely moves (no merging), but fill drops
    expect(after.leafCount).toBeGreaterThanOrEqual(beforeLeaves - 2);
    expect(after.fillPct).toBeLessThan(70);
  });

  it("a fully-emptied leaf is removed; tree stays valid", () => {
    const sim = createBtreeSim(4);
    sim.setMode("sequential");
    for (let i = 0; i < 20; i++) sim.insert();
    const oracle = new Set(sim.keysInOrder());
    // delete a contiguous run that should empty at least one leaf
    const sorted = [...oracle].sort((a, b) => a - b);
    for (const k of sorted.slice(0, LEAF_CAP)) {
      sim.deleteKey(k);
      oracle.delete(k);
    }
    assertTreeValid(sim, oracle);
  });

  it("deleting a missing key is a no-op", () => {
    const sim = createBtreeSim(5);
    for (let i = 0; i < 10; i++) sim.insert();
    const before = sim.keysInOrder();
    expect(sim.deleteKey(99999)).toBe(false);
    expect(sim.keysInOrder()).toEqual(before);
  });
});

describe("determinism, drivers, and abuse", () => {
  function drive(sim: BtreeSim): BtreeSnapshot {
    sim.setMode("random");
    sim.setWorkload(true);
    sim.step(350 * 30);
    return sim.snapshot();
  }

  it("same seed + same schedule yields the same tree", () => {
    const a = drive(createBtreeSim(42));
    const b = drive(createBtreeSim(42));
    expect(a.root).toEqual(b.root);
    expect(a.totalKeys).toBe(b.totalKeys);
  });

  it("workload stops at the demo cap and never exceeds it", () => {
    const sim = createBtreeSim(9);
    sim.setMode("sequential");
    sim.setWorkload(true);
    sim.step(350 * 200); // far more than needed to fill
    expect(sim.snapshot().totalKeys).toBeLessThanOrEqual(MAX_KEYS);
    expect(sim.snapshot().full).toBe(true);
  });

  it("reset restores an empty tree and RNG", () => {
    const sim = createBtreeSim(42);
    drive(sim);
    sim.reset();
    expect(sim.snapshot().totalKeys).toBe(0);
    expect(sim.snapshot().height).toBe(1);
    expect(drive(sim)).toEqual(drive(createBtreeSim(42)));
  });

  it("step(0)/negative and inserts past the cap never corrupt", () => {
    const sim = createBtreeSim(6);
    sim.setMode("sequential");
    sim.step(0);
    sim.step(-100);
    for (let i = 0; i < MAX_KEYS + 30; i++) sim.insert();
    const oracle = new Set(sim.keysInOrder());
    assertTreeValid(sim, oracle);
    expect(sim.snapshot().totalKeys).toBeLessThanOrEqual(MAX_KEYS);
  });

  it("SIMPLIFICATIONS is non-empty (the prose depends on it)", () => {
    expect(SIMPLIFICATIONS.length).toBeGreaterThan(0);
  });
});
