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
