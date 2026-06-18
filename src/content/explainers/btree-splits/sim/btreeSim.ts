export const LEAF_CAP = 5; // keys per leaf page
export const INTERNAL_CAP = 4; // children per internal page (≤ 3 separators)
export const MAX_KEYS = 60; // guard so the tree stays legible
export const DEFAULT_FILLFACTOR = 90; // Postgres btree leaf fillfactor default
export const KEY_RANGE = 900; // random keys drawn from [100, 999]

export type SplitKind = "rightmost" | "interior" | "internal";

export interface TreeNodeView {
  id: number;
  leaf: boolean;
  keys: number[];
  children?: TreeNodeView[];
  fillPct: number; // leaves only: keys / LEAF_CAP
  justSplit: boolean;
}

export interface BtreeSnapshot {
  root: TreeNodeView;
  height: number;
  leafCount: number;
  internalCount: number;
  totalKeys: number;
  capacityKeys: number; // leafCount * LEAF_CAP
  fillPct: number; // totalKeys / capacityKeys
  inserts: number;
  leafSplits: number;
  rightmostSplits: number;
  interiorSplits: number;
  internalSplits: number;
  splitsPerInsert: number;
  mode: InsertMode;
  fillfactor: number;
  workload: boolean;
  full: boolean;
  lastEvent: string | null;
  eventLog: string[];
}

export type InsertMode = "sequential" | "random";

export interface BtreeSim {
  step(dtMs: number): void;
  insert(): void; // insert one key per the current mode
  insertKey(key: number): boolean;
  deleteKey(key: number): boolean;
  setMode(mode: InsertMode): void;
  setFillfactor(ff: number): void;
  setWorkload(on: boolean): void;
  reset(): void;
  keysInOrder(): number[]; // for tests/oracle
  has(key: number): boolean;
  snapshot(): BtreeSnapshot;
}

export const SIMPLIFICATIONS: readonly string[] = [
  "A leaf holds 5 keys and an internal page 4 children, so a root split happens after a few dozen inserts. Real 8 KB btree pages hold hundreds of entries, so real trees are wide and shallow — three or four levels indexes billions of rows.",
  "Leaves store bare keys. A real btree leaf stores index tuples (key + heap ctid), and Postgres deduplicates repeated keys into posting lists (PG 13+), which changes when a page is considered full.",
  "The split point is modeled as a clean ratio: fillfactor on a rightmost-append split, 50/50 otherwise. Real _bt_findsplitloc weighs many candidate split points to balance space and avoid splitting between equal keys, and applies the rightmost-page heuristic more subtly.",
  "Deletes remove a key and drop a leaf only when it becomes completely empty. Real nbtree never merges underfull pages; VACUUM reclaims fully-empty pages and Postgres does opportunistic bottom-up deletion, but a half-empty page stays half-empty.",
  "No concurrency. The rightmost-leaf hotspot here is only about where splits land; in a real concurrent workload it is also a lock-contention point on a single buffer.",
  "No write-ahead log. Every page split is WAL-logged and a newly split page triggers a full-page image at the next checkpoint — the write amplification a split causes is invisible here.",
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Node {
  leaf: boolean;
  keys: number[];
  children: Node[];
  splitTick: number; // animation hint: tick at which this node last split
}

interface SplitResult {
  sep: number;
  right: Node;
  kind: SplitKind;
}

export function createBtreeSim(seed: number): BtreeSim {
  let rng = mulberry32(seed);
  let root: Node;
  let height: number;
  let mode: InsertMode;
  let fillfactor: number;
  let workload: boolean;
  let seqCounter: number;
  let inserts: number;
  let leafSplits: number;
  let rightmostSplits: number;
  let interiorSplits: number;
  let internalSplits: number;
  let tick: number;
  let burnTimerMs: number;
  let lastEvent: string | null;
  let eventLog: string[];

  const INSERT_INTERVAL_MS = 350;

  function leafNode(keys: number[] = []): Node {
    return { leaf: true, keys, children: [], splitTick: -1 };
  }

  function init(): void {
    rng = mulberry32(seed);
    root = leafNode([]);
    height = 1;
    mode = "sequential";
    fillfactor = DEFAULT_FILLFACTOR;
    workload = false;
    seqCounter = 100;
    inserts = 0;
    leafSplits = 0;
    rightmostSplits = 0;
    interiorSplits = 0;
    internalSplits = 0;
    tick = 0;
    burnTimerMs = 0;
    lastEvent = null;
    eventLog = [];
  }

  function log(line: string): void {
    lastEvent = line;
    eventLog.push(line);
    if (eventLog.length > 60) eventLog.shift();
  }

  function totalKeys(node: Node = root): number {
    if (node.leaf) return node.keys.length;
    return node.children.reduce((s, c) => s + totalKeys(c), 0);
  }

  function childIndexFor(node: Node, key: number): number {
    let i = 0;
    while (i < node.keys.length && key >= node.keys[i]) i += 1;
    return i;
  }

  function splitLeaf(node: Node, insertedAtEnd: boolean, onRightSpine: boolean): SplitResult {
    const n = node.keys.length; // == LEAF_CAP + 1
    let leftN: number;
    let kind: SplitKind;
    if (onRightSpine && insertedAtEnd) {
      // Rightmost-append: leave the left page filled to fillfactor and start a
      // fresh right page for the keys that keep arriving in order.
      leftN = Math.max(1, Math.min(LEAF_CAP, Math.floor((LEAF_CAP * fillfactor) / 100)));
      kind = "rightmost";
      rightmostSplits += 1;
    } else {
      leftN = Math.floor(n / 2);
      kind = "interior";
      interiorSplits += 1;
    }
    const right = leafNode(node.keys.slice(leftN));
    node.keys = node.keys.slice(0, leftN);
    leafSplits += 1;
    node.splitTick = tick;
    right.splitTick = tick;
    return { sep: right.keys[0], right, kind };
  }

  function splitInternal(node: Node): SplitResult {
    const mid = Math.floor(node.keys.length / 2);
    const sep = node.keys[mid];
    const right: Node = {
      leaf: false,
      keys: node.keys.slice(mid + 1),
      children: node.children.slice(mid + 1),
      splitTick: tick,
    };
    node.keys = node.keys.slice(0, mid);
    node.children = node.children.slice(0, mid + 1);
    node.splitTick = tick;
    internalSplits += 1;
    return { sep, right, kind: "internal" };
  }

  function insertInto(node: Node, key: number, onRightSpine: boolean): SplitResult | null {
    if (node.leaf) {
      // unique index: ignore duplicates
      let i = 0;
      while (i < node.keys.length && node.keys[i] < key) i += 1;
      if (node.keys[i] === key) return null;
      node.keys.splice(i, 0, key);
      const insertedAtEnd = i === node.keys.length - 1;
      if (node.keys.length <= LEAF_CAP) return null;
      return splitLeaf(node, insertedAtEnd, onRightSpine);
    }
    const idx = childIndexFor(node, key);
    const childRight = onRightSpine && idx === node.children.length - 1;
    const res = insertInto(node.children[idx], key, childRight);
    if (!res) return null;
    node.keys.splice(idx, 0, res.sep);
    node.children.splice(idx + 1, 0, res.right);
    if (node.children.length <= INTERNAL_CAP) return null;
    return splitInternal(node);
  }

  function doInsertKey(key: number): boolean {
    if (totalKeys() >= MAX_KEYS) {
      log(`tree at ${MAX_KEYS}-key demo cap — reset to continue`);
      return false;
    }
    tick += 1;
    const beforeLeaf = leafSplits;
    const beforeRightmost = rightmostSplits;
    const res = insertInto(root, key, true);
    if (res) {
      root = { leaf: false, keys: [res.sep], children: [root, res.right], splitTick: tick };
      height += 1;
      log(`insert ${key}: split cascaded to a NEW ROOT — tree is now height ${height}`);
    } else if (leafSplits > beforeLeaf) {
      const where = rightmostSplits > beforeRightmost ? "rightmost (fillfactor) split" : "interior 50/50 split";
      log(`insert ${key}: leaf full → ${where}`);
    }
    inserts += 1;
    return true;
  }

  function nextSequential(): number {
    return seqCounter++;
  }

  function nextRandom(): number {
    let attempts = 0;
    while (attempts < 2000) {
      const k = 100 + Math.floor(rng() * KEY_RANGE);
      if (!has(k)) return k;
      attempts += 1;
    }
    return 100 + Math.floor(rng() * KEY_RANGE);
  }

  function doInsert(): void {
    const key = mode === "sequential" ? nextSequential() : nextRandom();
    doInsertKey(key);
  }

  function findLeafPathFor(key: number): Node[] | null {
    const path: Node[] = [];
    let node = root;
    while (!node.leaf) {
      path.push(node);
      node = node.children[childIndexFor(node, key)];
    }
    path.push(node);
    return node.keys.includes(key) ? path : null;
  }

  function doDeleteKey(key: number): boolean {
    const path = findLeafPathFor(key);
    if (!path) return false;
    tick += 1;
    const leaf = path[path.length - 1];
    leaf.keys = leaf.keys.filter((k) => k !== key);
    // Drop a leaf only when it empties completely (real nbtree page deletion);
    // partially-full pages are never merged.
    if (leaf.keys.length === 0 && path.length >= 2) {
      const parent = path[path.length - 2];
      const ci = parent.children.indexOf(leaf);
      parent.children.splice(ci, 1);
      // remove the separator that pointed at this child
      const sepIdx = ci === 0 ? 0 : ci - 1;
      if (parent.keys.length > 0) parent.keys.splice(sepIdx, 1);
      // collapse a root that now has a single child
      if (parent === root && parent.children.length === 1) {
        root = parent.children[0];
        height -= 1;
      }
      log(`delete ${key}: leaf emptied and removed`);
    } else {
      log(`delete ${key}: removed from leaf (page kept, now ${leaf.keys.length}/${LEAF_CAP})`);
    }
    return true;
  }

  function has(key: number): boolean {
    let node = root;
    while (!node.leaf) node = node.children[childIndexFor(node, key)];
    return node.keys.includes(key);
  }

  function keysInOrder(node: Node = root): number[] {
    if (node.leaf) return [...node.keys];
    return node.children.flatMap((c) => keysInOrder(c));
  }

  function countNodes(node: Node = root): { leaves: number; internals: number } {
    if (node.leaf) return { leaves: 1, internals: 0 };
    return node.children.reduce(
      (acc, c) => {
        const r = countNodes(c);
        return { leaves: acc.leaves + r.leaves, internals: acc.internals + r.internals };
      },
      { leaves: 0, internals: 1 },
    );
  }

  let viewId = 0;
  function toView(node: Node): TreeNodeView {
    const id = viewId++;
    if (node.leaf) {
      return {
        id,
        leaf: true,
        keys: [...node.keys],
        fillPct: (node.keys.length / LEAF_CAP) * 100,
        justSplit: node.splitTick === tick,
      };
    }
    return {
      id,
      leaf: false,
      keys: [...node.keys],
      children: node.children.map(toView),
      fillPct: 0,
      justSplit: node.splitTick === tick,
    };
  }

  function doStep(dtMs: number): void {
    if (dtMs <= 0 || !workload) return;
    burnTimerMs += dtMs;
    let guard = 1000;
    while (burnTimerMs >= INSERT_INTERVAL_MS && guard-- > 0) {
      burnTimerMs -= INSERT_INTERVAL_MS;
      if (totalKeys() >= MAX_KEYS) {
        workload = false;
        break;
      }
      doInsert();
    }
  }

  function snapshotImpl(): BtreeSnapshot {
    viewId = 0;
    const { leaves, internals } = countNodes();
    const tk = totalKeys();
    const cap = leaves * LEAF_CAP;
    return {
      root: toView(root),
      height,
      leafCount: leaves,
      internalCount: internals,
      totalKeys: tk,
      capacityKeys: cap,
      fillPct: cap > 0 ? (tk / cap) * 100 : 0,
      inserts,
      leafSplits,
      rightmostSplits,
      interiorSplits,
      internalSplits,
      splitsPerInsert: inserts > 0 ? (leafSplits + internalSplits) / inserts : 0,
      mode,
      fillfactor,
      workload,
      full: tk >= MAX_KEYS,
      lastEvent,
      eventLog: [...eventLog],
    };
  }

  init();

  return {
    step: doStep,
    insert: doInsert,
    insertKey: doInsertKey,
    deleteKey: doDeleteKey,
    setMode(m: InsertMode) {
      mode = m;
    },
    setFillfactor(ff: number) {
      fillfactor = Math.max(10, Math.min(100, Math.round(ff)));
    },
    setWorkload(on: boolean) {
      workload = on;
      if (!on) burnTimerMs = 0;
    },
    reset: init,
    keysInOrder: () => keysInOrder(),
    has,
    snapshot: snapshotImpl,
  };
}
