# Bloom filters & the read-amp gap (#12) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build explainer #12, `bloom-filters-read-amp`, whose core interaction is a single tunable bloom filter (insert keys, watch bits fill, query for NO/MAYBE) with one supporting viz showing the LSM read-amplification payoff.

**Architecture:** Two pure deterministic sim units (`bloomSim.ts`, `lsmReadSim.ts`) with invariant unit tests written first, then two React island components (`BloomFilterViz`, `ReadAmpViz`) rendering SVG from sim snapshots, then prose in `index.mdx`, then a verification pass and edge-state QA. System state lives in the sim, never in `useState`.

**Tech Stack:** Astro static + React islands (`client:visible`), TypeScript, Vitest, Tailwind v4 with CSS-variable tokens, IBM Plex Mono/Sans.

## Global Constraints

- Astro static output; prose ships zero-JS; interactivity is React islands with `client:visible` only.
- All colours from `--color-*` tokens in `src/styles/global.css`; never hardcode hex in components. Semantic viz colours: ok=green, danger=red, pending=amber, entity=blue, dead=gray.
- Sim core is pure, deterministic, seeded TS with unit tests; React renders sim snapshots. System state never in `useState`.
- Typography: IBM Plex Mono for headings/nav/metadata/figure labels/captions/controls; IBM Plex Sans for body prose (`var(--font-mono)` / default sans).
- Every embedded viz wrapped in `src/components/Figure.astro` (`FIG. NN — LABEL`).
- No banner/section-divider comments. Prefer no comments; when one is needed, state a constraint the code can't show.
- Components honour `prefers-reduced-motion` with a stepped (Prev/Next) mode; hit targets ≥44px; work at 360px.
- Run tests with `pnpm vitest run <path>`. Verify build with `pnpm check` and `pnpm build` (do NOT start `pnpm dev`).
- `draft: true` until the verification pass is complete and the user has reviewed it.
- **Rule-of-two decision (do not deviate):** #5 `lsm-tree-compaction/sim/bloom.ts` already has a minimal fixed-size (64-bit, k=3) bloom filter. #12 needs a *parameterized* filter (variable m/k, double hashing, FPR model). These are different interfaces. Build a fresh `bloomSim.ts` in #12's folder; do NOT extract a shared abstraction and do NOT modify #5's published filter (it would force a re-QA of a live page for no DRY win).

---

### Task 1: Tunable bloom filter sim core

**Files:**
- Create: `src/content/explainers/bloom-filters-read-amp/sim/bloomSim.ts`
- Test: `src/content/explainers/bloom-filters-read-amp/sim/bloomSim.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `createBloom(m: number, k: number): BloomFilter`
  - `interface BloomFilter { insert(key:string):void; query(key:string):"NO"|"MAYBE"; probeBits(key:string):number[]; bits():readonly boolean[]; setBitCount():number; keyCount():number; reset():void; config():{m:number;k:number}; measuredFpr(probeSet:readonly string[]):number; theoreticalFpr():number; optimalK():number }`
  - Key-universe helpers: `memberKey(i:number):string` → `"user:"+i`, `missKey(i:number):string` → `"miss:"+i`, `memberKeys(n:number):string[]`, `missKeys(n:number):string[]`.

- [ ] **Step 1: Write the failing tests**

Create `bloomSim.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createBloom, memberKeys, missKeys } from "./bloomSim";

describe("no false negatives", () => {
  it("every inserted key queries MAYBE, for a range of (m,k,n)", () => {
    for (const m of [128, 512, 2048]) {
      for (const k of [1, 3, 7]) {
        const f = createBloom(m, k);
        const keys = memberKeys(80);
        for (const key of keys) f.insert(key);
        for (const key of keys) {
          expect(f.query(key), `false negative m=${m} k=${k} key=${key}`).toBe("MAYBE");
        }
      }
    }
  });
});

describe("monotonic degradation", () => {
  it("inserting more keys never turns a MAYBE back into a NO over a fixed probe set", () => {
    const f = createBloom(256, 3);
    const probes = missKeys(150);
    const members = memberKeys(60);
    let prevMaybe = 0;
    for (let n = 0; n <= members.length; n++) {
      if (n > 0) f.insert(members[n - 1]);
      const maybe = probes.filter((q) => f.query(q) === "MAYBE").length;
      expect(maybe, `maybe count dropped at n=${n}`).toBeGreaterThanOrEqual(prevMaybe);
      prevMaybe = maybe;
    }
  });
});

describe("determinism", () => {
  it("same (m,k) + same insert sequence → identical bits and verdicts", () => {
    const a = createBloom(512, 4);
    const b = createBloom(512, 4);
    for (const key of memberKeys(40)) { a.insert(key); b.insert(key); }
    expect(JSON.stringify(a.bits())).toBe(JSON.stringify(b.bits()));
    for (const q of missKeys(50)) expect(a.query(q)).toBe(b.query(q));
  });

  it("reset returns to all-zero", () => {
    const f = createBloom(128, 3);
    for (const key of memberKeys(20)) f.insert(key);
    f.reset();
    expect(f.setBitCount()).toBe(0);
    expect(f.keyCount()).toBe(0);
  });
});

describe("FPR model", () => {
  it("measured FPR tracks theoretical within tolerance over a large probe set", () => {
    const m = 4096, k = 4;
    const f = createBloom(m, k);
    for (const key of memberKeys(400)) f.insert(key);
    const measured = f.measuredFpr(missKeys(2000));
    const theo = f.theoreticalFpr();
    expect(Math.abs(measured - theo)).toBeLessThan(0.05);
  });

  it("probeBits returns exactly k indices within [0,m)", () => {
    const f = createBloom(200, 5);
    const pos = f.probeBits("user:7");
    expect(pos.length).toBe(5);
    for (const p of pos) { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThan(200); }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/content/explainers/bloom-filters-read-amp/sim/bloomSim.test.ts`
Expected: FAIL — `createBloom` not found (module missing).

- [ ] **Step 3: Implement `bloomSim.ts`**

```ts
function fnv1a32(s: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

const SALT_A = 0x00000000;
const SALT_B = 0x9e3779b1;

export interface BloomFilter {
  insert(key: string): void;
  query(key: string): "NO" | "MAYBE";
  probeBits(key: string): number[];
  bits(): readonly boolean[];
  setBitCount(): number;
  keyCount(): number;
  reset(): void;
  config(): { m: number; k: number };
  measuredFpr(probeSet: readonly string[]): number;
  theoreticalFpr(): number;
  optimalK(): number;
}

export function createBloom(m: number, k: number): BloomFilter {
  const arr = new Array<boolean>(m).fill(false);
  let added = 0;

  // Kirsch–Mitzenmacher double hashing: k indices from two base hashes.
  // h2 forced odd so it strides the whole array mod m.
  function positions(key: string): number[] {
    const h1 = fnv1a32(key, SALT_A);
    const h2 = fnv1a32(key, SALT_B) | 1;
    const out: number[] = [];
    for (let i = 0; i < k; i++) out.push(((h1 + Math.imul(i, h2)) >>> 0) % m);
    return out;
  }

  return {
    insert(key) {
      for (const p of positions(key)) arr[p] = true;
      added += 1;
    },
    query(key) {
      return positions(key).every((p) => arr[p]) ? "MAYBE" : "NO";
    },
    probeBits(key) {
      return positions(key);
    },
    bits() {
      return arr.slice();
    },
    setBitCount() {
      let c = 0;
      for (const b of arr) if (b) c += 1;
      return c;
    },
    keyCount() {
      return added;
    },
    reset() {
      arr.fill(false);
      added = 0;
    },
    config() {
      return { m, k };
    },
    measuredFpr(probeSet) {
      if (probeSet.length === 0) return 0;
      let fp = 0;
      for (const q of probeSet) if (this.query(q) === "MAYBE") fp += 1;
      return fp / probeSet.length;
    },
    theoreticalFpr() {
      if (added === 0) return 0;
      return Math.pow(1 - Math.exp((-k * added) / m), k);
    },
    optimalK() {
      if (added === 0) return k;
      return Math.max(1, Math.round((m / added) * Math.LN2));
    },
  };
}

export const memberKey = (i: number): string => `user:${i}`;
export const missKey = (i: number): string => `miss:${i}`;
export const memberKeys = (n: number): string[] => Array.from({ length: n }, (_, i) => memberKey(i));
export const missKeys = (n: number): string[] => Array.from({ length: n }, (_, i) => missKey(i));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/content/explainers/bloom-filters-read-amp/sim/bloomSim.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add src/content/explainers/bloom-filters-read-amp/sim/bloomSim.ts src/content/explainers/bloom-filters-read-amp/sim/bloomSim.test.ts
git commit -m "feat(bloom): tunable bloom filter sim core + invariant tests (#12)"
```

---

### Task 2: LSM read-path sim (FIG. 02 payoff)

**Files:**
- Create: `src/content/explainers/bloom-filters-read-amp/sim/lsmReadSim.ts`
- Test: `src/content/explainers/bloom-filters-read-amp/sim/lsmReadSim.test.ts`

**Interfaces:**
- Consumes: `createBloom`, `memberKey`, `missKey` from `./bloomSim`.
- Produces:
  - `createLsmRead(opts:{runs:number; keysPerRun:number; bitsPerKey:number}): LsmRead`
  - `interface LsmRead { lookup(key:string):ReadResult; setBitsPerKey(bpk:number):void; runCount():number; runKey(run:number, idx:number):string; bitsPerKey():number }`
  - `interface ReadResult { key:string; probes:RunProbe[]; runsProbed:number; found:boolean }`
  - `interface RunProbe { runId:number; level:string; verdict:"NO"|"MAYBE"; probed:boolean; hit:boolean; falsePositive:boolean }`

- [ ] **Step 1: Write the failing tests**

Create `lsmReadSim.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createLsmRead } from "./lsmReadSim";

describe("lsm read path", () => {
  it("a key present in a run is always found (filter never skips a containing run)", () => {
    const lsm = createLsmRead({ runs: 4, keysPerRun: 50, bitsPerKey: 10 });
    for (let r = 0; r < lsm.runCount(); r++) {
      const key = lsm.runKey(r, 0);
      expect(lsm.lookup(key).found, `lost key in run ${r}`).toBe(true);
    }
  });

  it("runsProbed never exceeds runCount", () => {
    const lsm = createLsmRead({ runs: 6, keysPerRun: 40, bitsPerKey: 8 });
    for (let i = 0; i < 200; i++) {
      const res = lsm.lookup(`miss:${i}`);
      expect(res.runsProbed).toBeLessThanOrEqual(lsm.runCount());
    }
  });

  it("starving bits/key raises average probes on a miss workload (monotone)", () => {
    const lsm = createLsmRead({ runs: 5, keysPerRun: 60, bitsPerKey: 16 });
    const avgProbes = () => {
      let total = 0;
      for (let i = 0; i < 300; i++) total += lsm.lookup(`miss:${i}`).runsProbed;
      return total / 300;
    };
    lsm.setBitsPerKey(16);
    const hi = avgProbes();
    lsm.setBitsPerKey(2);
    const lo = avgProbes();
    expect(lo).toBeGreaterThanOrEqual(hi);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/content/explainers/bloom-filters-read-amp/sim/lsmReadSim.test.ts`
Expected: FAIL — `createLsmRead` not found.

- [ ] **Step 3: Implement `lsmReadSim.ts`**

```ts
import { createBloom, type BloomFilter } from "./bloomSim";

export interface RunProbe {
  runId: number;
  level: string;
  verdict: "NO" | "MAYBE";
  probed: boolean;
  hit: boolean;
  falsePositive: boolean;
}

export interface ReadResult {
  key: string;
  probes: RunProbe[];
  runsProbed: number;
  found: boolean;
}

export interface LsmRead {
  lookup(key: string): ReadResult;
  setBitsPerKey(bpk: number): void;
  runCount(): number;
  runKey(run: number, idx: number): string;
  bitsPerKey(): number;
}

function levelLabel(run: number): string {
  if (run === 0) return "memtable";
  if (run <= 2) return "L0";
  return `L${run - 2}`;
}

export function createLsmRead(opts: { runs: number; keysPerRun: number; bitsPerKey: number }): LsmRead {
  const { runs, keysPerRun } = opts;
  let bpk = opts.bitsPerKey;

  // Each run owns a disjoint key range so a key lives in at most one run.
  const runKeySets: Set<string>[] = Array.from({ length: runs }, (_, r) => {
    const s = new Set<string>();
    for (let i = 0; i < keysPerRun; i++) s.add(`r${r}:k${i}`);
    return s;
  });

  let filters: BloomFilter[] = [];
  function rebuild() {
    filters = runKeySets.map((keys) => {
      const f = createBloom(Math.max(8, keysPerRun * bpk), Math.max(1, Math.round(bpk * Math.LN2)));
      for (const key of keys) f.insert(key);
      return f;
    });
  }
  rebuild();

  return {
    lookup(key) {
      const probes: RunProbe[] = [];
      let runsProbed = 0;
      let found = false;
      for (let r = 0; r < runs; r++) {
        const verdict = filters[r].query(key);
        const inRun = runKeySets[r].has(key);
        const probed = verdict === "MAYBE";
        if (probed) runsProbed += 1;
        const hit = probed && inRun;
        probes.push({
          runId: r,
          level: levelLabel(r),
          verdict,
          probed,
          hit,
          falsePositive: probed && !inRun,
        });
        if (hit) { found = true; break; }
      }
      return { key, probes, runsProbed, found };
    },
    setBitsPerKey(next) {
      bpk = next;
      rebuild();
    },
    runCount() {
      return runs;
    },
    runKey(run, idx) {
      return `r${run}:k${idx}`;
    },
    bitsPerKey() {
      return bpk;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/content/explainers/bloom-filters-read-amp/sim/lsmReadSim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/content/explainers/bloom-filters-read-amp/sim/lsmReadSim.ts src/content/explainers/bloom-filters-read-amp/sim/lsmReadSim.test.ts
git commit -m "feat(bloom): LSM read-path sim + invariant tests (#12)"
```

---

### Task 3: Scaffold the explainer so it renders in dev

**Files:**
- Create: `src/content/explainers/bloom-filters-read-amp/index.mdx` (frontmatter + skeleton)
- Create: `src/content/explainers/bloom-filters-read-amp/further.md`

**Interfaces:**
- Consumes: `Figure.astro`.
- Produces: a `draft: true` explainer that builds in dev only.

- [ ] **Step 1: Create `index.mdx` skeleton**

```mdx
---
title: "Bloom filters, or: the cheapest way to skip a disk read"
description: "A bloom filter answers 'is this key here?' in a few bytes per key — definitely-no, or maybe. Insert keys into one filter, starve it of memory, and watch its maybes pile up until it can't skip anything; then see why that single bit array decides how many sorted runs an LSM read has to touch."
number: 12
pubDate: 2026-06-30
draft: true
---

import Figure from "../../../components/Figure.astro";
import BloomFilterViz from "./components/BloomFilterViz";
import ReadAmpViz from "./components/ReadAmpViz";

Placeholder prose. Replaced in Task 6.

<Figure number={1} label="ONE FILTER, UP CLOSE">
  <BloomFilterViz client:visible />
</Figure>

<Figure number={2} label="THE READ-AMP PAYOFF">
  <ReadAmpViz client:visible />
</Figure>
```

- [ ] **Step 2: Create `further.md`**

```md
# Further — bloom-filters-read-amp parking lot

Material deliberately cut to keep #12 answering one question (how a bloom filter trades memory
for false positives, and why that decides LSM read amplification).

## Counting bloom filters & deletion
A plain bloom filter can't delete — clearing a bit shared with another key creates a false
negative. Counting filters replace bits with small counters; their own explainer.

## Cuckoo & ribbon filters
Cuckoo filters support deletion and lookups with better cache locality; ribbon filters (RocksDB
6.15+) cut memory ~30% at similar FPR for more CPU. The space/CPU/FPR surface is its own piece.

## Blocked bloom filters
Packing each key's k bits into one cache line trades a slightly worse FPR for one cache miss
per query instead of k. A "filters and the memory hierarchy" explainer.

## Prefix filters & range queries
Bloom filters answer point lookups only. RocksDB prefix filters approximate range pruning by
filtering on a key prefix; the trade-offs deserve their own treatment.
```

- [ ] **Step 3: Create empty component stubs so the import resolves**

Create `src/content/explainers/bloom-filters-read-amp/components/BloomFilterViz.tsx`:

```tsx
export default function BloomFilterViz() {
  return <div>BloomFilterViz</div>;
}
```

Create `src/content/explainers/bloom-filters-read-amp/components/ReadAmpViz.tsx`:

```tsx
export default function ReadAmpViz() {
  return <div>ReadAmpViz</div>;
}
```

- [ ] **Step 4: Verify it builds (dev-only draft)**

Run: `pnpm check`
Expected: 0 errors. (Draft excluded from `pnpm build`; that's expected.)

- [ ] **Step 5: Commit**

```bash
git add src/content/explainers/bloom-filters-read-amp/
git commit -m "scaffold(bloom): #12 folder, frontmatter, parking lot, component stubs"
```

---

### Task 4: FIG. 01 — `BloomFilterViz` (core interaction)

**Files:**
- Modify: `src/content/explainers/bloom-filters-read-amp/components/BloomFilterViz.tsx` (replace stub)

**Interfaces:**
- Consumes: `createBloom`, `memberKey`, `memberKeys`, `missKey`, `missKeys` from `../sim/bloomSim`.
- Produces: default-exported React component, no props.

**Behaviour:** The component holds, in refs (not `useState` for system state): an inserted-key list, current `m` (via bits/key) and `k`. On any control change it rebuilds the filter deterministically by re-inserting the key list. React state holds only UI/derived snapshot for render.

- [ ] **Step 1: Implement the component**

```tsx
import { useMemo, useRef, useState } from "react";
import { createBloom, memberKey, missKey, missKeys } from "../sim/bloomSim";

const MAX_KEYS = 64;
const PROBE_SET = missKeys(300);

export default function BloomFilterViz() {
  const insertedRef = useRef<string[]>([]);
  const [bitsPerKey, setBitsPerKey] = useState(8);
  const [k, setK] = useState(3);
  const [queryKey, setQueryKey] = useState<string | null>(null);
  const [, force] = useState(0);

  const n = insertedRef.current.length;
  const m = Math.max(16, Math.round(Math.max(n, 1) * bitsPerKey));

  const filter = useMemo(() => {
    const f = createBloom(m, k);
    for (const key of insertedRef.current) f.insert(key);
    return f;
  }, [m, k, n]);

  const bits = filter.bits();
  const fill = filter.setBitCount() / m;
  const measured = filter.measuredFpr(PROBE_SET);
  const theo = filter.theoreticalFpr();
  const optimalK = filter.optimalK();
  const probe = queryKey ? filter.probeBits(queryKey) : [];
  const probeSet = new Set(probe);
  const verdict = queryKey ? filter.query(queryKey) : null;
  const isMember = queryKey ? insertedRef.current.includes(queryKey) : false;
  const falsePositive = verdict === "MAYBE" && !isMember;

  const insertNext = () => {
    if (insertedRef.current.length >= MAX_KEYS) return;
    insertedRef.current.push(memberKey(insertedRef.current.length));
    setQueryKey(null);
    force((x) => x + 1);
  };
  const reset = () => {
    insertedRef.current = [];
    setQueryKey(null);
    force((x) => x + 1);
  };

  const cols = 32;
  const cell = 14;
  const rows = Math.ceil(m / cols);

  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
      <svg viewBox={`0 0 ${cols * cell} ${rows * cell}`} width="100%" role="img" aria-label="bloom filter bit array">
        {bits.map((on, i) => {
          const x = (i % cols) * cell;
          const y = Math.floor(i / cols) * cell;
          const probed = probeSet.has(i);
          let fillColor = on ? "var(--color-entity)" : "var(--color-raised)";
          if (probed) fillColor = on ? "var(--color-ok)" : "var(--color-danger)";
          return (
            <rect key={i} x={x + 1} y={y + 1} width={cell - 2} height={cell - 2} rx={2}
              fill={fillColor} stroke="var(--color-rule)" strokeWidth={0.5} />
          );
        })}
      </svg>

      <div aria-live="polite" style={{ marginTop: 8, color: "var(--color-muted)" }}>
        {verdict && queryKey && (
          <span style={{ color: verdict === "NO" ? "var(--color-muted)" : falsePositive ? "var(--color-danger)" : "var(--color-ok)" }}>
            query {queryKey} → {verdict}
            {verdict === "NO" && " (definitely absent)"}
            {verdict === "MAYBE" && !falsePositive && " (present)"}
            {falsePositive && " — FALSE POSITIVE"}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 8 }}>
        <span>n = {n}</span>
        <span>m = {m} bits</span>
        <span>fill = {(fill * 100).toFixed(0)}%</span>
        <span>measured FPR = {(measured * 100).toFixed(1)}%</span>
        <span>theoretical FPR = {(theo * 100).toFixed(1)}%</span>
        <span style={{ color: k === optimalK ? "var(--color-ok)" : "var(--color-pending)" }}>optimal k = {optimalK}</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button onClick={insertNext} style={btn(true)}>Insert key</button>
        <button onClick={() => { setQueryKey(memberKey(0)); force((x) => x + 1); }} style={btn(false)} disabled={n === 0}>Query a present key</button>
        <button onClick={() => { setQueryKey(missKey(7)); force((x) => x + 1); }} style={btn(false)}>Query an absent key</button>
        <button onClick={reset} style={btn(false)}>Reset</button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginTop: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          bits/key = {bitsPerKey}
          <input type="range" min={2} max={20} value={bitsPerKey} onChange={(e) => setBitsPerKey(+e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          k = {k}
          <input type="range" min={1} max={12} value={k} onChange={(e) => setK(+e.target.value)} />
        </label>
      </div>
    </div>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return {
    minHeight: 44,
    minWidth: 44,
    padding: "8px 14px",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    cursor: "pointer",
    border: "1px solid var(--color-rule)",
    borderRadius: 3,
    background: primary ? "var(--color-entity)" : "var(--color-raised)",
    color: primary ? "var(--color-bg)" : "var(--color-ink)",
  };
}
```

- [ ] **Step 2: Verify types and lint**

Run: `pnpm check`
Expected: 0 errors. If `--color-bg` is not a defined token, substitute the nearest defined background token from `src/styles/global.css` (read it to confirm token names: `--color-bg`, `--color-raised`, `--color-ink`, `--color-muted`, `--color-rule`, `--color-entity`, `--color-ok`, `--color-danger`, `--color-pending`).

- [ ] **Step 3: Manual smoke (build only, do NOT start dev)**

Run: `pnpm build` — note that the draft is excluded, so confirm no type/compile error is thrown for the component during `pnpm check` in Step 2 instead. The component is exercised in dev by the author.

- [ ] **Step 4: Commit**

```bash
git add src/content/explainers/bloom-filters-read-amp/components/BloomFilterViz.tsx
git commit -m "feat(bloom): FIG.01 BloomFilterViz core interaction (#12)"
```

---

### Task 5: FIG. 02 — `ReadAmpViz` (LSM payoff)

**Files:**
- Modify: `src/content/explainers/bloom-filters-read-amp/components/ReadAmpViz.tsx` (replace stub)

**Interfaces:**
- Consumes: `createLsmRead`, `type ReadResult` from `../sim/lsmReadSim`.
- Produces: default-exported React component, no props.

- [ ] **Step 1: Implement the component**

```tsx
import { useMemo, useRef, useState } from "react";
import { createLsmRead, type ReadResult } from "../sim/lsmReadSim";

const RUNS = 6;

export default function ReadAmpViz() {
  const [bitsPerKey, setBitsPerKey] = useState(10);
  const lsm = useMemo(() => createLsmRead({ runs: RUNS, keysPerRun: 60, bitsPerKey }), [bitsPerKey]);
  const [result, setResult] = useState<ReadResult | null>(null);
  const missCounter = useRef(0);

  const lookupMiss = () => setResult(lsm.lookup(`miss:${missCounter.current++}`));
  const lookupHit = () => setResult(lsm.lookup(lsm.runKey(RUNS - 1, 0)));

  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {Array.from({ length: RUNS }, (_, r) => {
          const probe = result?.probes.find((p) => p.runId === r);
          let bg = "var(--color-raised)";
          let note = "";
          if (probe) {
            if (probe.verdict === "NO") { bg = "var(--color-raised)"; note = "filter: NO → skip"; }
            else if (probe.hit) { bg = "var(--color-ok)"; note = "filter: MAYBE → probe → HIT"; }
            else if (probe.falsePositive) { bg = "var(--color-danger)"; note = "filter: MAYBE → probe → miss (false positive)"; }
            else { bg = "var(--color-pending)"; note = "filter: MAYBE → probe"; }
          }
          return (
            <div key={r} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: bg, border: "1px solid var(--color-rule)", borderRadius: 3 }}>
              <span style={{ width: 64 }}>{probe?.level ?? `run ${r}`}</span>
              <span style={{ color: "var(--color-muted)", fontSize: 11 }}>{note}</span>
            </div>
          );
        })}
      </div>

      <div aria-live="polite" style={{ marginTop: 8 }}>
        {result && (
          <span>
            read {result.key} → {result.found ? "found" : "not found"} · read-amp ={" "}
            <strong>{result.runsProbed}</strong> / {RUNS} runs probed
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <button onClick={lookupMiss} style={readBtn(true)}>Look up a missing key</button>
        <button onClick={lookupHit} style={readBtn(false)}>Look up a present key</button>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12 }}>
        bits/key = {bitsPerKey} (drag toward 2 to starve the filters)
        <input type="range" min={2} max={20} value={bitsPerKey} onChange={(e) => setBitsPerKey(+e.target.value)} />
      </label>
    </div>
  );
}

function readBtn(primary: boolean): React.CSSProperties {
  return {
    minHeight: 44, padding: "8px 14px", fontFamily: "var(--font-mono)", fontSize: 12, cursor: "pointer",
    border: "1px solid var(--color-rule)", borderRadius: 3,
    background: primary ? "var(--color-entity)" : "var(--color-raised)",
    color: primary ? "var(--color-bg)" : "var(--color-ink)",
  };
}
```

- [ ] **Step 2: Verify types**

Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/content/explainers/bloom-filters-read-amp/components/ReadAmpViz.tsx
git commit -m "feat(bloom): FIG.02 ReadAmpViz LSM read-amp payoff (#12)"
```

---

### Task 6: Prose

**Files:**
- Modify: `src/content/explainers/bloom-filters-read-amp/index.mdx` (replace placeholder body)

**Interfaces:** none new.

- [ ] **Step 1: Write the prose** following the spec's arc: hook (LSM point-lookup miss touches every run, read-amp = N) → naive fix (hold every key in memory) → the filter → FIG.01 → failure modes (saturation, over-hashing, no-delete) → real-world grounding (RocksDB 10 bits/key ≈ 1%, full-key vs prefix, ribbon) → FIG.02 → wrapping up → Sources. 1,500–3,000 words. Label every simplification in place. Banned phrases (per CLAUDE.md and skill): no "delve", "leverage" (verb), "simply", "just" (as minimizer), "magic", "In today's world", "Let's dive in".

The Sources section must list: Bloom (1970); Kirsch & Mitzenmacher "Less Hashing, Same Performance"; the RocksDB Bloom-filter wiki page; and the FPR/optimal-k formulas. Leave exact citations to be confirmed in Task 7.

- [ ] **Step 2: Verify build (still draft, so check only)**

Run: `pnpm check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/content/explainers/bloom-filters-read-amp/index.mdx
git commit -m "feat(bloom): prose for #12 bloom filters & read-amp gap (draft)"
```

---

### Task 7: Verification pass (gates publishing)

**Files:**
- Create: `src/content/explainers/bloom-filters-read-amp/verification.md`

- [ ] **Step 1: Extract every checkable claim** from the prose and figure captions into a checklist (FPR formula, optimal-k formula, RocksDB defaults, double-hashing technique, "no false negatives", "no delete without false negatives", "filters don't help range scans").

- [ ] **Step 2: Verify each against primary sources** — Bloom (1970), Kirsch & Mitzenmacher, RocksDB wiki/source. Mark each ✅ verified (with source) / ⚠️ simplification (must be labeled in prose) / ❌ wrong-or-unverifiable (fix or cut). Record a resolution log like the #6/#7 `verification.md` files.

- [ ] **Step 3: Re-run all sim tests**

Run: `pnpm vitest run src/content/explainers/bloom-filters-read-amp`
Expected: PASS. If a prose fix changed a claim the sim models, fix the sim too and re-run.

- [ ] **Step 4: Commit**

```bash
git add src/content/explainers/bloom-filters-read-amp/verification.md
git commit -m "docs(bloom): verification pass for #12"
```

- [ ] **Step 5: Present the checklist to the user for review.** Do NOT flip `draft: false` until the user has reviewed and approved — the PRD's definition of done requires human review before publishing.

---

### Task 8: Edge-state QA, OG image, publish

**Files:**
- Modify: `src/content/explainers/bloom-filters-read-amp/index.mdx` (flip `draft: false` only after user approval)

- [ ] **Step 1: Edge-state QA** of both components (author drives in dev): rapid button spam, slider spam, query before any insert, reset mid-state, 360px width, `prefers-reduced-motion`, tab-background. Note: if either component needs a reduced-motion stepped mode (FIG.01/02 are event-driven, not rAF-animated, so continuous motion is minimal — confirm the stepped-mode requirement is satisfied by the discrete click-to-advance nature, or add Prev/Next if the author judges it needed).

- [ ] **Step 2: Banned-phrase scan** of `index.mdx`.

Run: `grep -niE "\b(delve|leverage|simply|just|magic|dive in|in today)\b" src/content/explainers/bloom-filters-read-amp/index.mdx`
Expected: no matches that are minimizers/banned (review each hit; "just" in a non-minimizing sense is acceptable).

- [ ] **Step 3: Regenerate OG image**

Run: `pnpm og`
Expected: `public/og/bloom-filters-read-amp.png` created.

- [ ] **Step 4: Flip to published (after user approval) and full build**

Edit frontmatter `draft: true` → `draft: false`, then:
Run: `pnpm check && pnpm build`
Expected: 0 errors; page count increases by 1; `dist/bloom-filters-read-amp/index.html` exists and home list includes the slug.

- [ ] **Step 5: Commit**

```bash
git add src/content/explainers/bloom-filters-read-amp/ public/og/bloom-filters-read-amp.png
git commit -m "feat(bloom): publish #12 bloom filters & the read-amp gap"
```

---

## Self-Review

**Spec coverage:**
- Core interaction (single filter, insert/query/m/k, starve + over-hash breaks) → Task 1 (sim) + Task 4 (FIG.01). ✅
- FIG.02 read-amp payoff → Task 2 (sim) + Task 5. ✅
- FPR curve folded into FIG.01 readout → Task 4 live stats. ✅
- Invariants 1–4 (no false negatives, monotonic degradation, determinism, FPR model) → Task 1 tests; read-path invariants → Task 2 tests. ✅
- Double hashing (Kirsch–Mitzenmacher), FNV-1a base → Task 1 `positions()`. ✅
- Prose arc + banned-phrase rule → Task 6 + Task 8 Step 2. ✅
- Primary-source verification gating publish, human review → Task 7. ✅
- Sources section → Task 6 Step 1 + Task 7. ✅
- Scope guard / parking lot → Task 3 `further.md`. ✅
- OG image → Task 8 Step 3. ✅
- Rule-of-two (do not extract / don't touch #5) → Global Constraints. ✅

**Placeholder scan:** Task 6 prose is described by arc + constraints rather than full text — this is intentional (prose is authored content, not mechanical code), but the arc, length, Sources list, and banned-phrase gate are all concrete. No "TBD"/"handle edge cases" left in code steps.

**Type consistency:** `createBloom(m,k)`, `query→"NO"|"MAYBE"`, `probeBits`, `measuredFpr`, `theoreticalFpr`, `optimalK`, `setBitCount` consistent across Tasks 1/4. `createLsmRead`, `ReadResult`, `RunProbe.verdict`, `runsProbed`, `runKey`, `setBitsPerKey` consistent across Tasks 2/5. ✅
