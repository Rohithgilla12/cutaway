export const KEY_COUNT = 32;
export const MEMTABLE_FLUSH_THRESHOLD = 8;
export const L0_COMPACTION_THRESHOLD = 4;
export const L1_MAX_FILES = 4;
export const AUTO_WRITE_INTERVAL_MS = 200; // ~5 writes/s

export type ProbeStructure = "memtable" | "L0" | "L1";

// User-visible read outcome. A deleted key reads as "absent" — the tombstone that
// shadowed it is an internal detail, surfaced per-probe via ProbeView.found, not as
// an outcome. (A point read of a deleted key returns "not found" to the caller.)
export type ReadOutcome = "value" | "absent";

export interface ProbeView {
  structure: ProbeStructure;
  // For L0/L1 probes this identifies the SSTable; null for the memtable.
  tableId: number | null;
  // "hit" means the probed structure held an entry for the key (value OR tombstone)
  // and the read stopped here. "miss" means the key was not in this structure's
  // covered range (or simply absent) so the read continued downward.
  hit: boolean;
  // When hit, what was found at this structure.
  found?: "value" | "tombstone";
}

export interface ReadPath {
  key: string;
  outcome: ReadOutcome;
  value: number | null;
  probes: ProbeView[];
  // readAmplification == probes.length: number of structures touched for this read.
  readAmplification: number;
}

export interface MemtableEntryView {
  key: string;
  value: number | null; // null == tombstone
  tombstone: boolean;
}

export interface SSTableView {
  id: number;
  level: 0 | 1;
  keys: string[];
  minKey: string | null;
  maxKey: string | null;
  entryCount: number;
  tombstoneCount: number;
  sizeBytes: number;
  // Monotonic creation order; lower == older. Drives L0 newest-first probing.
  seq: number;
}

export interface LsmSnapshot {
  memtable: MemtableEntryView[];
  memtableSizeBytes: number;
  l0: SSTableView[]; // newest-first (probe order)
  l1: SSTableView[]; // sorted by key range, non-overlapping
  lastReadPath: ReadPath | null;
  // Amplification metrics.
  writeAmplification: number; // total bytes written to all levels / user bytes written
  readAmplificationLast: number; // probes in last read
  readAmplificationAvg: number; // rolling mean of read amplification
  spaceAmplification: number; // live bytes on disk / unique-live-key bytes
  // Raw counters feeding the metrics, exposed for the viz.
  userBytesWritten: number;
  totalBytesWritten: number;
  l0FileCount: number;
  l1FileCount: number;
  l0SizeBytes: number;
  l1SizeBytes: number;
  tombstoneCount: number; // tombstones currently live in L0 + L1 (+ memtable)
  compactionPressure: boolean; // l0FileCount >= L0_COMPACTION_THRESHOLD
  autoWrite: boolean;
  autoFlush: boolean;
  autoCompact: boolean;
  eventLog: string[];
}

export interface LsmSim {
  step(dtMs: number): void;
  setAutoWrite(on: boolean): void;
  writeRandom(): void;
  write(key: string, value: number): void;
  delete(key: string): void;
  deleteRandom(): void;
  flush(): void;
  compact(): void;
  setAutoFlush(on: boolean): void;
  setAutoCompact(on: boolean): void;
  get(keyOrRandom?: string): ReadPath;
  reset(): void;
  snapshot(): LsmSnapshot;
}

export const SIMPLIFICATIONS: readonly string[] = [
  "No write-ahead log: a real engine writes every memtable mutation to a WAL first so an unflushed memtable survives a crash. We skip the WAL entirely — see explainer #1 (WAL crash recovery) for that half of the story.",
  "Single column family: one keyspace, one memtable, one LSM tree. Real RocksDB runs many column families, each with its own memtable and levels sharing a WAL.",
  "Only two levels (L0 and L1). Real engines stack L0..L6 with a size ratio (~10x) between adjacent levels; compaction cascades downward, not just L0->L1.",
  "No bloom filters. We deliberately probe every candidate SSTable so read amplification equals the number of structures touched — the metric the viz teaches. Real engines attach a per-SSTable bloom filter (~1% false-positive) that lets a point read skip most non-overlapping tables, so real read-amp is far below file count.",
  "No block cache, no index/data block split, no MVCC sequence numbers or snapshots. Newest-version-wins is resolved purely by structure recency (memtable > newer L0 > older L0 > L1).",
  "Tombstones drop at L1 because L1 is the bottommost level here. Real engines only drop a tombstone at the bottommost level AND when no older snapshot could still need the key it shadows.",
  "Sizes are entry counts times a fixed per-entry byte cost, not real encoded block sizes. Compaction output is re-partitioned by even key-range splitting rather than a target file size.",
  "Flush threshold (8 entries) and L0 trigger (4 files) are tiny so every key and table is visible. Production thresholds are megabytes and dozens of files.",
];

const ENTRY_BYTES = 64;

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

interface Entry {
  key: string;
  value: number; // ignored when tombstone
  tombstone: boolean;
}

interface SSTable {
  id: number;
  level: 0 | 1;
  // Sorted by key ascending. At most one entry per key (latest version at build time).
  entries: Entry[];
  seq: number; // monotonic creation order; lower == older
}

function tableSize(t: SSTable): number {
  return t.entries.length * ENTRY_BYTES;
}

function tableTombstones(t: SSTable): number {
  return t.entries.filter((e) => e.tombstone).length;
}

function minKeyOf(t: SSTable): string | null {
  return t.entries.length ? t.entries[0].key : null;
}

function maxKeyOf(t: SSTable): string | null {
  return t.entries.length ? t.entries[t.entries.length - 1].key : null;
}

// Two L1 tables overlap if their inclusive key ranges intersect. Used both to find
// the L1 file a read or compaction must touch and to assert L1 disjointness.
function rangesOverlap(aMin: string, aMax: string, bMin: string, bMax: string): boolean {
  return aMin <= bMax && bMin <= aMax;
}

export function createLsmSim(seed: number): LsmSim {
  const rng = mulberry32(seed);

  let memtable: Map<string, Entry>;
  let l0: SSTable[]; // stored oldest-first; probe order reverses it
  let l1: SSTable[]; // stored sorted by key range ascending, non-overlapping
  let nextTableId: number;
  let nextSeq: number;
  let lastReadPath: ReadPath | null;
  let userBytesWritten: number;
  let totalBytesWritten: number;
  let readCount: number;
  let readAmpSum: number;
  let readAmpLast: number;
  let autoWrite: boolean;
  let autoFlush: boolean;
  let autoCompact: boolean;
  let writeTimerMs: number;
  let eventLog: string[];

  function init(): void {
    memtable = new Map();
    l0 = [];
    l1 = [];
    nextTableId = 0;
    nextSeq = 0;
    lastReadPath = null;
    userBytesWritten = 0;
    totalBytesWritten = 0;
    readCount = 0;
    readAmpSum = 0;
    readAmpLast = 0;
    autoWrite = false;
    autoFlush = false;
    autoCompact = false;
    writeTimerMs = 0;
    eventLog = [];
  }

  function log(line: string): void {
    eventLog.push(line);
    if (eventLog.length > 60) eventLog.shift();
  }

  function memtableSize(): number {
    return memtable.size * ENTRY_BYTES;
  }

  function putMemtable(entry: Entry): void {
    // Every user mutation is a logical write of ENTRY_BYTES to the memtable.
    userBytesWritten += ENTRY_BYTES;
    totalBytesWritten += ENTRY_BYTES;
    memtable.set(entry.key, entry);
    if (autoFlush && memtable.size >= MEMTABLE_FLUSH_THRESHOLD) {
      doFlush();
    }
  }

  function doWrite(key: string, value: number): void {
    putMemtable({ key, value, tombstone: false });
  }

  function doWriteRandom(): void {
    const key = keyName(Math.floor(rng() * KEY_COUNT));
    const value = 1 + Math.floor(rng() * 99);
    doWrite(key, value);
  }

  function doDelete(key: string): void {
    putMemtable({ key, value: 0, tombstone: true });
  }

  function doDeleteRandom(): void {
    doDelete(keyName(Math.floor(rng() * KEY_COUNT)));
  }

  // Flush: the sorted memtable becomes one new L0 SSTable (overlapping ranges with
  // existing L0 are allowed — that is the defining L0 property). Memtable clears.
  function doFlush(): void {
    if (memtable.size === 0) return;
    const entries = [...memtable.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const table: SSTable = {
      id: nextTableId++,
      level: 0,
      entries,
      seq: nextSeq++,
    };
    const bytes = tableSize(table);
    totalBytesWritten += bytes; // bytes rewritten one level down
    l0.push(table);
    const tombstones = tableTombstones(table);
    log(
      `memtable full — flushed to L0-${table.id} (${entries.length} keys` +
        (tombstones ? `, ${tombstones} tombstones` : "") +
        `)`,
    );
    memtable.clear();
    if (autoCompact && l0.length >= L0_COMPACTION_THRESHOLD) {
      doCompact();
    }
  }

  // Re-partition a flat sorted entry list into <= L1_MAX_FILES contiguous,
  // non-overlapping SSTables by even splitting. Empty entries -> no tables.
  function partitionL1(entries: Entry[]): SSTable[] {
    if (entries.length === 0) return [];
    const fileCount = Math.min(L1_MAX_FILES, entries.length);
    const per = Math.ceil(entries.length / fileCount);
    const tables: SSTable[] = [];
    for (let i = 0; i < entries.length; i += per) {
      tables.push({
        id: nextTableId++,
        level: 1,
        entries: entries.slice(i, i + per),
        seq: nextSeq++,
      });
    }
    return tables;
  }

  // Leveled L0 -> L1 compaction. Merge ALL L0 tables with the L1 tables whose
  // ranges overlap the merged L0 key span, then re-partition the result. Newest
  // version of each key wins (memtable already gone; among SSTables, higher seq is
  // newer). Tombstones are dropped here because L1 is the bottommost level.
  //
  // Real RocksDB only rewrites the overlapping subset of the next level. Here the
  // key space is tiny and L0 flushes usually span most of it, so any single
  // compaction tends to touch every L1 file anyway. To keep L1 globally
  // non-overlapping and bounded at L1_MAX_FILES with simple even-split
  // partitioning, we fold in the untouched L1 tables too and re-partition the
  // whole level. The overlapping-count is still reported for the event log.
  function doCompact(): void {
    if (l0.length === 0) return;

    const l0Count = l0.length;

    // Determine the L0 key span to report how many L1 tables genuinely overlapped.
    let spanMin: string | null = null;
    let spanMax: string | null = null;
    for (const t of l0) {
      const lo = minKeyOf(t);
      const hi = maxKeyOf(t);
      if (lo === null || hi === null) continue;
      if (spanMin === null || lo < spanMin) spanMin = lo;
      if (spanMax === null || hi > spanMax) spanMax = hi;
    }
    let overlappingL1Count = 0;
    for (const t of l1) {
      const lo = minKeyOf(t);
      const hi = maxKeyOf(t);
      if (
        lo !== null &&
        hi !== null &&
        spanMin !== null &&
        spanMax !== null &&
        rangesOverlap(lo, hi, spanMin, spanMax)
      ) {
        overlappingL1Count += 1;
      }
    }

    // Merge order: oldest -> newest so later writes overwrite earlier ones.
    // All L1 (older than every L0 here) seeds the map first, then L0 oldest->newest.
    const inputs: SSTable[] = [
      ...l1.slice().sort((a, b) => a.seq - b.seq),
      ...l0.slice().sort((a, b) => a.seq - b.seq),
    ];
    const merged = new Map<string, Entry>();
    let inputEntryCount = 0;
    for (const t of inputs) {
      for (const e of t.entries) merged.set(e.key, e); // later (newer) wins
      inputEntryCount += t.entries.length;
    }

    let droppedTombstones = 0;
    const live: Entry[] = [];
    for (const e of merged.values()) {
      if (e.tombstone) {
        // L1 is bottommost: a tombstone has shadowed everything below, so drop it.
        droppedTombstones += 1;
        continue;
      }
      live.push(e);
    }
    live.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const obsoleteVersions = inputEntryCount - merged.size;

    const newL1 = partitionL1(live);

    // Bytes written: the new L1 files are the rewrite cost (write amplification).
    let rewriteBytes = 0;
    for (const t of newL1) rewriteBytes += tableSize(t);
    totalBytesWritten += rewriteBytes;

    log(
      `compaction: ${l0Count} L0 + ${overlappingL1Count} L1 -> ${newL1.length} L1 files, ` +
        `dropped ${droppedTombstones} tombstones, ${obsoleteVersions} obsolete versions`,
    );

    l0 = [];
    l1 = newL1;
  }

  // Point read. Probe memtable, then each L0 newest -> oldest, then the single
  // overlapping L1 file. Stop at the first structure that holds the key (value or
  // tombstone). readAmplification == number of structures probed.
  function doGet(keyOrRandom?: string): ReadPath {
    const key = keyOrRandom !== undefined ? keyOrRandom : keyName(Math.floor(rng() * KEY_COUNT));

    const probes: ProbeView[] = [];
    let outcome: ReadOutcome = "absent";
    let value: number | null = null;
    // The read stops at the first structure holding the key — value OR tombstone.
    // A tombstone STOPS the read (it shadows everything below) but the user-visible
    // outcome is "absent": the key is deleted. probe.found preserves the distinction
    // for the viz (a tombstone hit looks different from a value hit).
    let stopped = false;
    const recordHit = (e: Entry): void => {
      if (e.tombstone) {
        outcome = "absent";
        value = null;
      } else {
        outcome = "value";
        value = e.value;
      }
      stopped = true;
    };

    // 1. Memtable (newest).
    {
      const e = memtable.get(key);
      if (e !== undefined) {
        probes.push({
          structure: "memtable",
          tableId: null,
          hit: true,
          found: e.tombstone ? "tombstone" : "value",
        });
        recordHit(e);
      } else {
        probes.push({ structure: "memtable", tableId: null, hit: false });
      }
    }

    // 2. L0 newest -> oldest (overlapping ranges allowed, so probe every table).
    if (!stopped) {
      const l0Newest = l0.slice().sort((a, b) => b.seq - a.seq);
      for (const t of l0Newest) {
        const e = t.entries.find((x) => x.key === key);
        if (e !== undefined) {
          probes.push({
            structure: "L0",
            tableId: t.id,
            hit: true,
            found: e.tombstone ? "tombstone" : "value",
          });
          recordHit(e);
          break;
        }
        probes.push({ structure: "L0", tableId: t.id, hit: false });
      }
    }

    // 3. The one L1 file whose range covers the key (L1 is non-overlapping).
    if (!stopped) {
      const target = l1.find((t) => {
        const lo = minKeyOf(t);
        const hi = maxKeyOf(t);
        return lo !== null && hi !== null && lo <= key && key <= hi;
      });
      if (target) {
        const e = target.entries.find((x) => x.key === key);
        if (e !== undefined) {
          probes.push({
            structure: "L1",
            tableId: target.id,
            hit: true,
            found: e.tombstone ? "tombstone" : "value",
          });
          recordHit(e);
        } else {
          probes.push({ structure: "L1", tableId: target.id, hit: false });
        }
      }
    }

    const path: ReadPath = {
      key,
      outcome,
      value,
      probes,
      readAmplification: probes.length,
    };
    lastReadPath = path;
    readCount += 1;
    readAmpSum += probes.length;
    readAmpLast = probes.length;
    return path;
  }

  function runAutoWrite(dtMs: number): void {
    if (!autoWrite) return;
    writeTimerMs += dtMs;
    let guard = 10000;
    while (writeTimerMs >= AUTO_WRITE_INTERVAL_MS && guard-- > 0) {
      writeTimerMs -= AUTO_WRITE_INTERVAL_MS;
      // Mostly writes, occasional delete (seeded), so tombstones accumulate.
      if (rng() < 0.15) doDeleteRandom();
      else doWriteRandom();
    }
  }

  function doStep(dtMs: number): void {
    if (dtMs <= 0) return;
    runAutoWrite(dtMs);
  }

  // ---- snapshot helpers ----

  function viewTable(t: SSTable): SSTableView {
    return {
      id: t.id,
      level: t.level,
      keys: t.entries.map((e) => e.key),
      minKey: minKeyOf(t),
      maxKey: maxKeyOf(t),
      entryCount: t.entries.length,
      tombstoneCount: tableTombstones(t),
      sizeBytes: tableSize(t),
      seq: t.seq,
    };
  }

  function liveTombstoneCount(): number {
    let n = 0;
    for (const e of memtable.values()) if (e.tombstone) n += 1;
    for (const t of l0) n += tableTombstones(t);
    for (const t of l1) n += tableTombstones(t);
    return n;
  }

  // Space amplification = bytes physically on disk / bytes the live unique keys
  // would occupy with no duplicate or obsolete versions. Resolve the live view
  // top-down (memtable wins, then newer L0, then L1) to count unique live keys.
  function spaceAmp(): number {
    const onDiskBytes = l0.reduce((s, t) => s + tableSize(t), 0) + l1.reduce((s, t) => s + tableSize(t), 0);
    if (onDiskBytes === 0) return 1;

    const resolved = new Map<string, Entry>();
    // L1 oldest first, then L0 oldest -> newest so newer overwrites older.
    const ordered = [...l1.slice().sort((a, b) => a.seq - b.seq), ...l0.slice().sort((a, b) => a.seq - b.seq)];
    for (const t of ordered) {
      for (const e of t.entries) resolved.set(e.key, e);
    }
    let liveKeys = 0;
    for (const e of resolved.values()) if (!e.tombstone) liveKeys += 1;
    const liveBytes = liveKeys * ENTRY_BYTES;
    if (liveBytes === 0) return onDiskBytes === 0 ? 1 : onDiskBytes / ENTRY_BYTES;
    return onDiskBytes / liveBytes;
  }

  function snapshotImpl(): LsmSnapshot {
    const memtableView: MemtableEntryView[] = [...memtable.values()]
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((e) => ({
        key: e.key,
        value: e.tombstone ? null : e.value,
        tombstone: e.tombstone,
      }));

    const l0View = l0
      .slice()
      .sort((a, b) => b.seq - a.seq) // newest-first == probe order
      .map(viewTable);
    const l1View = l1
      .slice()
      .sort((a, b) => {
        const am = minKeyOf(a);
        const bm = minKeyOf(b);
        if (am === null) return 1;
        if (bm === null) return -1;
        return am < bm ? -1 : am > bm ? 1 : 0;
      })
      .map(viewTable);

    const l0SizeBytes = l0.reduce((s, t) => s + tableSize(t), 0);
    const l1SizeBytes = l1.reduce((s, t) => s + tableSize(t), 0);

    return {
      memtable: memtableView,
      memtableSizeBytes: memtableSize(),
      l0: l0View,
      l1: l1View,
      lastReadPath: lastReadPath
        ? {
            ...lastReadPath,
            probes: lastReadPath.probes.map((p) => ({ ...p })),
          }
        : null,
      writeAmplification: userBytesWritten === 0 ? 1 : totalBytesWritten / userBytesWritten,
      readAmplificationLast: readAmpLast,
      readAmplificationAvg: readCount === 0 ? 0 : readAmpSum / readCount,
      spaceAmplification: spaceAmp(),
      userBytesWritten,
      totalBytesWritten,
      l0FileCount: l0.length,
      l1FileCount: l1.length,
      l0SizeBytes,
      l1SizeBytes,
      tombstoneCount: liveTombstoneCount(),
      compactionPressure: l0.length >= L0_COMPACTION_THRESHOLD,
      autoWrite,
      autoFlush,
      autoCompact,
      eventLog: [...eventLog],
    };
  }

  init();

  return {
    step: doStep,
    setAutoWrite(on: boolean) {
      autoWrite = on;
      if (!on) writeTimerMs = 0;
    },
    writeRandom: doWriteRandom,
    write: doWrite,
    delete: doDelete,
    deleteRandom: doDeleteRandom,
    flush: doFlush,
    compact: doCompact,
    setAutoFlush(on: boolean) {
      autoFlush = on;
    },
    setAutoCompact(on: boolean) {
      autoCompact = on;
    },
    get: doGet,
    reset: init,
    snapshot: snapshotImpl,
  };
}
