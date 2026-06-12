export const KEY_COUNT = 64;
export const MEMTABLE_FLUSH_THRESHOLD = 8;
export const MERGE_TRIGGER_RUNS = 4; // scaled-down level0_file_num_compaction_trigger / STCS min_threshold
export const STOP_TRIGGER_RUNS = 8; // scaled-down level0_stop_writes_trigger
export const MAX_LEVEL = 3;
export const LEVEL_TARGETS: readonly number[] = [0, 16, 64, Infinity]; // entries; ratio 4, scaled from real ~10
export const DISK_BUDGET_PER_SEC = 24; // entries/s the disk can write (flush + compaction share it)
export const INGEST_MIN = 2;
export const INGEST_MAX = 24;
export const AUTO_READ_INTERVAL_MS = 500;

export type Strategy = "leveled" | "tiered";

export interface RunView {
  id: number;
  level: number;
  seq: number;
  size: number;
  beingCompacted: boolean;
}

export interface JobView {
  targetLevel: number;
  inputRunIds: number[];
  inputSize: number;
  outputSize: number;
  writtenSoFar: number;
  full: boolean;
}

export interface ReadProbe {
  structure: "memtable" | "run";
  runId: number | null;
  level: number | null;
  hit: boolean;
}

export interface ReadPath {
  key: string;
  found: boolean;
  value: number | null;
  probes: ReadProbe[];
  readAmplification: number;
}

export interface CompactionSnapshot {
  strategy: Strategy;
  levels: RunView[][]; // index 0..MAX_LEVEL, runs newest-first (probe order)
  memtableSize: number;
  job: JobView | null;
  ingestRate: number;
  stalled: boolean;
  stalledWrites: number;
  totalUserEntries: number;
  totalEntriesWritten: number; // memtable + flush + compaction output
  writeAmplification: number;
  readAmplificationLast: number;
  readAmplificationAvg: number;
  spaceAmplification: number; // on-disk entries / unique live keys on disk
  onDiskEntries: number; // includes in-progress compaction output
  uniqueLiveOnDisk: number;
  runCount: number; // sorted runs on disk == worst-case read amplification - 1 (memtable)
  l0RunCount: number;
  autoRead: boolean;
  lastReadPath: ReadPath | null;
  eventLog: string[];
}

export interface CompactionSim {
  step(dtMs: number): void;
  setStrategy(s: Strategy): void;
  setIngestRate(perSec: number): void;
  setAutoRead(on: boolean): void;
  write(key: string, value: number): void;
  read(key?: string): ReadPath;
  fullCompaction(): void;
  reset(): void;
  snapshot(): CompactionSnapshot;
}

export const SIMPLIFICATIONS: readonly string[] = [
  "Four levels, fanout 4, runs of dozens of entries. Real engines run L0..L6 with ~10x level targets and gigabyte runs; the shape of the trade survives the scaling, the constants do not.",
  "One compaction job at a time, so compaction debt is visible quickly. Real engines run several background jobs (max_background_jobs) and subcompactions in parallel.",
  "The write stall is binary and drops writes into a stalled counter once L0 reaches the stop trigger. Real engines first throttle (level0_slowdown_writes_trigger), then block the write path — latency spikes, not lost writes.",
  "No bloom filters, block cache, or per-run index: a point read probes every run that could hold the key, so read amplification equals sorted-run count along the probe path — the quantity the strategy controls. Production read-amp sits far below run count because of filters.",
  "Pure update workload over a fixed keyspace, no deletes, so there are no tombstones and space amplification is purely superseded versions.",
  "Tiered compaction merges ALL runs of an overfull tier into the next; real universal/STCS picks similarly-sized subsets with size ratios and space-amp limits.",
  "Disk budget is a single entries-per-second number shared by flush and compaction, flush first. Real engines manage byte rates, rate limiters, and compaction I/O priorities.",
  "The memtable can briefly overshoot its flush threshold while the disk budget is busy; real engines bound memtable memory and stall writers there too.",
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

function keyName(i: number): string {
  return `k${i.toString().padStart(2, "0")}`;
}

interface Run {
  id: number;
  level: number;
  seq: number; // creation order; within a level, higher seq == newer data
  keys: Map<string, number>;
}

interface Job {
  targetLevel: number;
  inputs: Run[];
  output: Map<string, number>;
  writtenSoFar: number;
  full: boolean;
}

export function createCompactionSim(
  seed: number,
  opts: { strategy?: Strategy; ingestRate?: number } = {},
): CompactionSim {
  let rng = mulberry32(seed);

  let strategy: Strategy;
  let ingestRate: number;
  let memtable: Map<string, number>;
  let levels: Run[][];
  let job: Job | null;
  let nextRunId: number;
  let nextSeq: number;
  let autoRead: boolean;
  let stalledWrites: number;
  let totalUserEntries: number;
  let totalEntriesWritten: number;
  let ingestAcc: number;
  let budgetAcc: number;
  let readTimerMs: number;
  let readCount: number;
  let readAmpSum: number;
  let readAmpLast: number;
  let lastReadPath: ReadPath | null;
  let eventLog: string[];

  function init(): void {
    rng = mulberry32(seed);
    strategy = opts.strategy ?? "leveled";
    ingestRate = opts.ingestRate ?? 6;
    memtable = new Map();
    levels = Array.from({ length: MAX_LEVEL + 1 }, () => []);
    job = null;
    nextRunId = 0;
    nextSeq = 0;
    autoRead = true;
    stalledWrites = 0;
    totalUserEntries = 0;
    totalEntriesWritten = 0;
    ingestAcc = 0;
    budgetAcc = 0;
    readTimerMs = 0;
    readCount = 0;
    readAmpSum = 0;
    readAmpLast = 0;
    lastReadPath = null;
    eventLog = [];
  }

  function log(line: string): void {
    eventLog.push(line);
    if (eventLog.length > 60) eventLog.shift();
  }

  function allRuns(): Run[] {
    return levels.flat();
  }

  function levelSize(i: number): number {
    return levels[i].reduce((s, r) => s + r.keys.size, 0);
  }

  function stalled(): boolean {
    return levels[0].length >= STOP_TRIGGER_RUNS;
  }

  function putKey(key: string, value: number): void {
    memtable.set(key, value);
    totalUserEntries += 1;
    totalEntriesWritten += 1;
  }

  function writeRandomKey(): void {
    putKey(keyName(Math.floor(rng() * KEY_COUNT)), 1 + Math.floor(rng() * 999));
  }

  // Flush the memtable as one new level-0 run. Costs its size in disk budget.
  function flush(): void {
    const run: Run = {
      id: nextRunId++,
      level: 0,
      seq: nextSeq++,
      keys: new Map(memtable),
    };
    levels[0].push(run);
    totalEntriesWritten += run.keys.size;
    memtable.clear();
    log(`flush -> run ${run.id} at L0 (${run.keys.size} entries); L0 now ${levels[0].length} runs`);
    if (stalled()) {
      log(`L0 at ${levels[0].length} runs >= stop trigger ${STOP_TRIGGER_RUNS} — WRITE STALL`);
    }
  }

  // Merge a set of runs into one output map, oldest content first so newer
  // values win. Content recency is structural — deeper level == older data,
  // then seq within a level — NOT raw seq: a compaction output's seq is newer
  // than runs flushed during that compaction, but its content is older.
  function mergeInputs(inputs: Run[]): Map<string, number> {
    const out = new Map<string, number>();
    const oldestFirst = inputs.slice().sort((a, b) => (a.level !== b.level ? b.level - a.level : a.seq - b.seq));
    for (const r of oldestFirst) {
      for (const [k, v] of r.keys) out.set(k, v);
    }
    return out;
  }

  function startJob(inputs: Run[], targetLevel: number, full: boolean): void {
    job = {
      targetLevel,
      inputs,
      output: mergeInputs(inputs),
      writtenSoFar: 0,
      full,
    };
    const inputSize = inputs.reduce((s, r) => s + r.keys.size, 0);
    log(
      `${full ? "full " : ""}compaction started: ${inputs.length} runs (${inputSize} entries) -> L${targetLevel} (${job.output.size} entries out)`,
    );
  }

  function finishJob(): void {
    if (!job) return;
    const inputIds = new Set(job.inputs.map((r) => r.id));
    for (let i = 0; i <= MAX_LEVEL; i++) {
      levels[i] = levels[i].filter((r) => !inputIds.has(r.id));
    }
    const run: Run = {
      id: nextRunId++,
      level: job.targetLevel,
      seq: nextSeq++,
      keys: job.output,
    };
    levels[job.targetLevel].push(run);
    log(`compaction done: run ${run.id} at L${job.targetLevel} (${run.keys.size} entries)`);
    job = null;
  }

  // Pick the next compaction job. Single job at a time; priority is the run
  // pile-up that threatens the write path first.
  function scheduleJob(): void {
    if (job) return;
    if (strategy === "leveled") {
      // L0 trigger: fold ALL L0 runs plus the L1 run into a new single L1 run.
      if (levels[0].length >= MERGE_TRIGGER_RUNS) {
        startJob([...levels[0], ...levels[1]], 1, false);
        return;
      }
      // Level overflow: fold the level into the one below, keeping one run per level.
      for (let i = 1; i < MAX_LEVEL; i++) {
        if (levelSize(i) > LEVEL_TARGETS[i] && levels[i].length > 0) {
          startJob([...levels[i], ...levels[i + 1]], i + 1, false);
          return;
        }
      }
    } else {
      // Tiered: the lowest tier with enough similar runs merges them into one
      // run on the next tier. Nothing is rewritten until a tier fills.
      for (let i = 0; i <= MAX_LEVEL; i++) {
        if (levels[i].length >= MERGE_TRIGGER_RUNS) {
          startJob([...levels[i]], Math.min(i + 1, MAX_LEVEL), false);
          return;
        }
      }
    }
  }

  function doRead(keyOrRandom?: string): ReadPath {
    const key = keyOrRandom !== undefined ? keyOrRandom : keyName(Math.floor(rng() * KEY_COUNT));
    const probes: ReadProbe[] = [];
    let found = false;
    let value: number | null = null;

    const mv = memtable.get(key);
    probes.push({ structure: "memtable", runId: null, level: null, hit: mv !== undefined });
    if (mv !== undefined) {
      found = true;
      value = mv;
    }

    if (!found) {
      // Data only moves down, so level-ascending + newest-first within a level
      // is strict recency order even mid-compaction (inputs stay probe-able
      // until the output run replaces them).
      outer: for (let i = 0; i <= MAX_LEVEL; i++) {
        for (const r of levels[i].slice().sort((a, b) => b.seq - a.seq)) {
          const v = r.keys.get(key);
          probes.push({ structure: "run", runId: r.id, level: i, hit: v !== undefined });
          if (v !== undefined) {
            found = true;
            value = v;
            break outer;
          }
        }
      }
    }

    const path: ReadPath = { key, found, value, probes, readAmplification: probes.length };
    lastReadPath = path;
    readCount += 1;
    readAmpSum += probes.length;
    readAmpLast = probes.length;
    return path;
  }

  function doStep(dtMs: number): void {
    if (dtMs <= 0) return;

    // Ingest at the configured rate; refused while stalled.
    ingestAcc += (ingestRate * dtMs) / 1000;
    let guard = 10000;
    while (ingestAcc >= 1 && guard-- > 0) {
      ingestAcc -= 1;
      if (stalled()) stalledWrites += 1;
      else writeRandomKey();
    }

    // Disk budget: flush has strict priority. A flush may drive the balance
    // negative (the disk is busy ahead); the compaction job only spends while
    // the balance is positive, so flush debt is always repaid first.
    budgetAcc += (DISK_BUDGET_PER_SEC * dtMs) / 1000;
    if (memtable.size >= MEMTABLE_FLUSH_THRESHOLD && budgetAcc > 0) {
      budgetAcc -= memtable.size;
      flush();
    }
    scheduleJob();
    if (job && budgetAcc > 0) {
      const remaining = job.output.size - job.writtenSoFar;
      const spend = Math.min(budgetAcc, remaining);
      job.writtenSoFar += spend;
      budgetAcc -= spend;
      totalEntriesWritten += spend;
      if (job.writtenSoFar >= job.output.size) finishJob();
    } else if (!job) {
      // Idle disk does not bank unlimited budget.
      budgetAcc = Math.min(budgetAcc, MEMTABLE_FLUSH_THRESHOLD * 2);
    }

    if (autoRead) {
      readTimerMs += dtMs;
      let rguard = 1000;
      while (readTimerMs >= AUTO_READ_INTERVAL_MS && rguard-- > 0) {
        readTimerMs -= AUTO_READ_INTERVAL_MS;
        doRead();
      }
    }
  }

  function uniqueLiveOnDisk(): number {
    const seen = new Set<string>();
    for (const r of allRuns()) for (const k of r.keys.keys()) seen.add(k);
    return seen.size;
  }

  function snapshotImpl(): CompactionSnapshot {
    const inputIds = new Set(job?.inputs.map((r) => r.id) ?? []);
    const levelViews: RunView[][] = levels.map((runs, li) =>
      runs
        .slice()
        .sort((a, b) => b.seq - a.seq)
        .map((r) => ({
          id: r.id,
          level: li,
          seq: r.seq,
          size: r.keys.size,
          beingCompacted: inputIds.has(r.id),
        })),
    );

    const runEntries = allRuns().reduce((s, r) => s + r.keys.size, 0);
    const onDisk = runEntries + (job ? job.writtenSoFar : 0);
    const liveUnique = uniqueLiveOnDisk();

    return {
      strategy,
      levels: levelViews,
      memtableSize: memtable.size,
      job: job
        ? {
            targetLevel: job.targetLevel,
            inputRunIds: job.inputs.map((r) => r.id),
            inputSize: job.inputs.reduce((s, r) => s + r.keys.size, 0),
            outputSize: job.output.size,
            writtenSoFar: job.writtenSoFar,
            full: job.full,
          }
        : null,
      ingestRate,
      stalled: stalled(),
      stalledWrites,
      totalUserEntries,
      totalEntriesWritten,
      writeAmplification: totalUserEntries === 0 ? 1 : totalEntriesWritten / totalUserEntries,
      readAmplificationLast: readAmpLast,
      readAmplificationAvg: readCount === 0 ? 0 : readAmpSum / readCount,
      spaceAmplification: liveUnique === 0 ? 1 : onDisk / liveUnique,
      onDiskEntries: onDisk,
      uniqueLiveOnDisk: liveUnique,
      runCount: allRuns().length,
      l0RunCount: levels[0].length,
      autoRead,
      lastReadPath: lastReadPath ? { ...lastReadPath, probes: lastReadPath.probes.map((p) => ({ ...p })) } : null,
      eventLog: [...eventLog],
    };
  }

  init();

  return {
    step: doStep,
    setStrategy(s: Strategy) {
      if (s === strategy) return;
      strategy = s;
      log(`strategy -> ${s} (existing runs stay; the new scheduler takes over)`);
    },
    setIngestRate(perSec: number) {
      ingestRate = Math.max(0, Math.min(INGEST_MAX, perSec));
    },
    write: putKey,
    setAutoRead(on: boolean) {
      autoRead = on;
      if (!on) readTimerMs = 0;
    },
    read: doRead,
    fullCompaction() {
      if (job) {
        log("full compaction refused: a compaction is already running");
        return;
      }
      const inputs = allRuns();
      if (inputs.length <= 1) {
        log("full compaction skipped: nothing to merge");
        return;
      }
      startJob(inputs, MAX_LEVEL, true);
    },
    reset: init,
    snapshot: snapshotImpl,
  };
}
