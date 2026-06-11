export type WalPhase = "running" | "crashed" | "recovering" | "recovered";

export type WalRecordKind = "begin" | "update" | "commit";

export interface WalRecord {
  lsn: number;
  txid: number;
  kind: WalRecordKind;
  pageId?: number;
  value?: number;
  sizeBytes: number;
}

export type RecordDurability = "durable" | "buffered" | "torn";

export interface WalRecordView extends WalRecord {
  durability: RecordDurability;
  replayed: boolean;
}

export type TxnStatus = "in-flight" | "acked" | "lost" | "survived";

export interface TxnView {
  txid: number;
  status: TxnStatus;
  commitLsn?: number;
}

export interface PageView {
  pageId: number;
  memory: number;
  disk: number;
}

export interface WalSnapshot {
  phase: WalPhase;
  records: WalRecordView[];
  lastLsn: number;
  lastDurableLsn: number;
  checkpointLsn: number;
  pages: PageView[];
  txns: TxnView[];
  fsyncCount: number;
  commitCount: number;
  flushInFlight: boolean;
  currentReplayLsn: number | null;
  recoveryLog: string[];
  acked: number;
  survived: number;
  lost: number;
  fsyncOnCommit: boolean;
  loadOn: boolean;
}

export interface WalSim {
  step(dtMs: number): void;
  commit(): void;
  setLoad(on: boolean): void;
  setFsyncOnCommit(on: boolean): void;
  checkpoint(): void;
  crash(): void;
  startRecovery(): void;
  recoverStep(): void;
  recoverAll(): void;
  reset(): void;
  snapshot(): WalSnapshot;
}

export const SIMPLIFICATIONS: readonly string[] = [
  "Single WAL writer: one global flush at a time, no concurrent writers competing for the buffer.",
  "CRC is modeled as a boolean (valid / torn) rather than a real polynomial checksum.",
  "A torn write only damages the FIRST record of the in-flight batch; real torn pages can corrupt anywhere in the partially-written block.",
  "No per-page redo LSN: recovery replays every committed update from the checkpoint rather than skipping pages already flushed past their change.",
  "Updates apply to in-memory pages immediately at commit time; real engines apply redo during replay against page LSNs.",
  "Disk page writes happen only at checkpoint; there is no background bgwriter eviction.",
  "Fixed record sizes and a fixed flush duration; no real I/O latency distribution.",
  "No undo / no aborts: every started transaction commits (or is lost to a crash).",
  "No full-page writes after a checkpoint (Postgres does this to survive torn page writes on the data files themselves).",
];

const PAGE_COUNT = 8;
const FLUSH_DURATION_MS = 5;
const BACKGROUND_FLUSH_INTERVAL_MS = 200;
const LOAD_INTERVAL_MS = 40; // ~25 txn/s when load is on
const RECORD_SIZE_BYTES = 64;
const CHECKPOINT_EVERY_COMMITS = 12;

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

interface StoredRecord extends WalRecord {
  // durability is derived: a record is durable iff lsn <= lastDurableLsn and not torn.
  torn: boolean;
  replayed: boolean;
}

interface FlushBatch {
  // The torn-tail candidate: the first (lowest-LSN) record this flush is writing.
  // If a crash lands mid-flush, only this record is half-written (bad CRC).
  firstLsn: number;
  elapsedMs: number;
}

interface InternalTxn {
  txid: number;
  status: TxnStatus;
  commitLsn?: number;
  // pages this txn updated, captured so we can decide survived vs lost after recovery
  updates: Array<{ pageId: number; value: number }>;
}

export function createWalSim(seed: number): WalSim {
  let rng = mulberry32(seed);

  let phase: WalPhase;
  let records: StoredRecord[];
  let lastLsn: number;
  let lastDurableLsn: number;
  let checkpointLsn: number;
  let memoryPages: number[];
  let diskPages: number[];
  let txns: InternalTxn[];
  let nextTxid: number;
  let fsyncCount: number;
  let commitCount: number;
  let commitsSinceCheckpoint: number;
  let flush: FlushBatch | null;
  let backgroundTimerMs: number;
  let loadTimerMs: number;
  let loadOn: boolean;
  let fsyncOnCommit: boolean;
  let recoveryLog: string[];
  let currentReplayLsn: number | null;
  // recovery cursor: index into the durable+valid record list being replayed
  let replayCursor: number;
  let replayStopped: boolean;

  function init(): void {
    // Re-seed the RNG so a reset sim reproduces the same trajectory as a fresh
    // createWalSim(seed) call — the advanced RNG state from a prior run must not
    // carry over into the restarted simulation.
    rng = mulberry32(seed);
    phase = "running";
    records = [];
    lastLsn = 0;
    lastDurableLsn = 0;
    checkpointLsn = 0;
    memoryPages = new Array(PAGE_COUNT).fill(0);
    diskPages = new Array(PAGE_COUNT).fill(0);
    txns = [];
    nextTxid = 1;
    fsyncCount = 0;
    commitCount = 0;
    commitsSinceCheckpoint = 0;
    flush = null;
    backgroundTimerMs = 0;
    loadTimerMs = 0;
    loadOn = false;
    fsyncOnCommit = true;
    recoveryLog = [];
    currentReplayLsn = null;
    replayCursor = 0;
    replayStopped = false;
  }

  function appendRecord(rec: Omit<StoredRecord, "torn" | "replayed">): StoredRecord {
    const stored: StoredRecord = { ...rec, torn: false, replayed: false };
    records.push(stored);
    return stored;
  }

  // Records currently in wal_buffer = appended but not yet durable. An in-flight
  // flush has not persisted anything until it completes, so these are still at risk.
  function bufferedLsns(): number[] {
    return records.filter((r) => r.lsn > lastDurableLsn).map((r) => r.lsn);
  }

  function beginFlushIfIdle(): void {
    if (flush) return; // single WAL writer: one flush in flight at a time
    const pending = bufferedLsns();
    if (pending.length === 0) return;
    flush = { firstLsn: Math.min(...pending), elapsedMs: 0 };
  }

  function ackDurableTxns(): void {
    for (const t of txns) {
      if (
        t.status === "in-flight" &&
        t.commitLsn !== undefined &&
        t.commitLsn <= lastDurableLsn
      ) {
        t.status = "acked";
      }
    }
  }

  // A completed fsync persists the WAL up to its current write position — every
  // record appended before completion becomes durable, not just those buffered
  // when the flush began. This is what lets several commits share one fsync
  // (group commit): the later arrivals ride the same flush to disk.
  function completeFlush(): void {
    if (!flush) return;
    lastDurableLsn = Math.max(lastDurableLsn, lastLsn);
    fsyncCount += 1;
    flush = null;
    ackDurableTxns();
  }

  function doCommit(): void {
    if (phase !== "running") return;
    const txid = nextTxid++;
    const pageId = Math.floor(rng() * PAGE_COUNT);
    const value = 1 + Math.floor(rng() * 9);

    appendRecord({ lsn: ++lastLsn, txid, kind: "begin", sizeBytes: RECORD_SIZE_BYTES });
    appendRecord({
      lsn: ++lastLsn,
      txid,
      kind: "update",
      pageId,
      value,
      sizeBytes: RECORD_SIZE_BYTES,
    });
    const commitLsn = ++lastLsn;
    appendRecord({ lsn: commitLsn, txid, kind: "commit", sizeBytes: RECORD_SIZE_BYTES });

    // Updates apply to in-memory pages immediately (simplified; see SIMPLIFICATIONS).
    memoryPages[pageId] = value;

    const txn: InternalTxn = {
      txid,
      status: "in-flight",
      commitLsn,
      updates: [{ pageId, value }],
    };
    txns.push(txn);
    commitCount += 1;
    commitsSinceCheckpoint += 1;

    if (fsyncOnCommit) {
      // Force a flush. If one is already in flight, this commit's records ride
      // that same flush to disk when it completes — group commit. The ack is
      // derived from durability, not granted here, so a crash before the flush
      // completes correctly leaves this txn unacked.
      beginFlushIfIdle();
    } else {
      // fsync-off footgun: ack immediately, records sit in wal_buffer.
      txn.status = "acked";
    }

    if (commitsSinceCheckpoint >= CHECKPOINT_EVERY_COMMITS) {
      doCheckpoint();
    }
  }

  function doCheckpoint(): void {
    if (phase !== "running") return;
    // A checkpoint forces the buffer durable, then writes in-memory pages to disk.
    // If a flush is already in flight, let it stand and just persist to the current
    // write position; either way the checkpoint barrier is fully durable afterward.
    if (bufferedLsns().length > 0 || flush) {
      lastDurableLsn = Math.max(lastDurableLsn, lastLsn);
      fsyncCount += 1;
      flush = null;
      ackDurableTxns();
    }
    for (let i = 0; i < PAGE_COUNT; i++) diskPages[i] = memoryPages[i];
    checkpointLsn = lastDurableLsn;
    commitsSinceCheckpoint = 0;
  }

  function advanceFlush(dtMs: number): void {
    if (!flush) return;
    flush.elapsedMs += dtMs;
    if (flush.elapsedMs >= FLUSH_DURATION_MS) {
      completeFlush();
    }
  }

  function runBackgroundFlush(dtMs: number): void {
    backgroundTimerMs += dtMs;
    while (backgroundTimerMs >= BACKGROUND_FLUSH_INTERVAL_MS) {
      backgroundTimerMs -= BACKGROUND_FLUSH_INTERVAL_MS;
      if (!flush) beginFlushIfIdle();
    }
  }

  function runLoad(dtMs: number): void {
    if (!loadOn) return;
    loadTimerMs += dtMs;
    while (loadTimerMs >= LOAD_INTERVAL_MS) {
      loadTimerMs -= LOAD_INTERVAL_MS;
      doCommit();
    }
  }

  function doStep(dtMs: number): void {
    if (phase !== "running") return;
    if (dtMs <= 0) return;
    // Order: generate load (appends records), advance any in-flight flush,
    // then run the background flush for fsync-off mode.
    runLoad(dtMs);
    advanceFlush(dtMs);
    runBackgroundFlush(dtMs);
  }

  function doCrash(): void {
    // Valid in any phase. Crashing during recovery/recovered restarts the crash.
    // Capture durable prefix: records with lsn <= lastDurableLsn survive.
    // If a flush was in flight, its FIRST record may be torn: physically on disk
    // (lsn <= lastDurableLsn after we extend), but failing CRC.
    if (flush) {
      const tornLsn = flush.firstLsn;
      // The torn record's bytes reached the platter, extending the durable boundary
      // to cover it, but its CRC is bad so recovery will reject it and everything after.
      lastDurableLsn = Math.max(lastDurableLsn, tornLsn);
      const tornRec = records.find((r) => r.lsn === tornLsn);
      if (tornRec) tornRec.torn = true;
      flush = null;
    }
    // Anything still buffered (lsn > lastDurableLsn) is lost.
    // Mark acked txns whose commit record is not durable (or is torn) as lost.
    for (const t of txns) {
      if (t.commitLsn === undefined) continue;
      const commitRec = records.find((r) => r.lsn === t.commitLsn);
      const commitDurable =
        commitRec !== undefined && t.commitLsn <= lastDurableLsn && !commitRec.torn;
      if (!commitDurable) {
        if (t.status === "acked") t.status = "lost";
        else if (t.status === "in-flight") t.status = "lost";
      }
    }
    phase = "crashed";
    recoveryLog = [];
    currentReplayLsn = null;
    replayCursor = 0;
    replayStopped = false;
  }

  // Records eligible for replay: durable, CRC-valid, after the checkpoint, in LSN order.
  // Replay stops at the first torn record (and everything after it is truncated).
  function replayList(): StoredRecord[] {
    const durableValid: StoredRecord[] = [];
    const ordered = [...records].sort((a, b) => a.lsn - b.lsn);
    for (const r of ordered) {
      if (r.lsn > lastDurableLsn) break; // beyond durable boundary — never written
      if (r.torn) break; // CRC mismatch: truncate the tail here
      durableValid.push(r);
    }
    return durableValid.filter((r) => r.lsn > checkpointLsn);
  }

  function startRecoveryImpl(): void {
    if (phase !== "crashed") return;
    phase = "recovering";
    // Recovery starts from the last checkpoint: reset in-memory pages to the
    // on-disk (checkpoint) image, then replay forward.
    for (let i = 0; i < PAGE_COUNT; i++) memoryPages[i] = diskPages[i];
    for (const r of records) r.replayed = false;
    replayCursor = 0;
    replayStopped = false;
    currentReplayLsn = null;
    recoveryLog = [`recovery start — replaying from checkpoint LSN ${checkpointLsn}`];

    // Detect the torn tail up front for the log narrative.
    const ordered = [...records].sort((a, b) => a.lsn - b.lsn);
    for (const r of ordered) {
      if (r.lsn > lastDurableLsn) break;
      if (r.torn) {
        recoveryLog.push(`LSN ${r.lsn} CRC mismatch — torn tail, truncating here`);
        break;
      }
    }
  }

  function applyRecord(r: StoredRecord): void {
    if (r.kind === "update" && r.pageId !== undefined && r.value !== undefined) {
      memoryPages[r.pageId] = r.value;
    }
  }

  function finishRecovery(): void {
    // A txn survived iff its commit record is durable and CRC-valid. That includes
    // commits already folded into the checkpoint (disk pages) as well as commits
    // re-applied during this replay pass — the replay window only governs what gets
    // re-applied, not what counts as durable.
    for (const t of txns) {
      if (t.commitLsn === undefined) continue;
      const commitRec = records.find((r) => r.lsn === t.commitLsn);
      const commitDurable =
        commitRec !== undefined && t.commitLsn <= lastDurableLsn && !commitRec.torn;
      t.status = commitDurable ? "survived" : "lost";
    }
    phase = "recovered";
    currentReplayLsn = null;
    const survivedN = txns.filter((t) => t.status === "survived").length;
    const lostN = txns.filter((t) => t.status === "lost").length;
    recoveryLog.push(`recovery complete — ${survivedN} survived, ${lostN} lost`);
  }

  function recoverStepImpl(): void {
    if (phase === "crashed") {
      startRecoveryImpl();
      return;
    }
    if (phase !== "recovering") return;
    const list = replayList();
    if (replayStopped || replayCursor >= list.length) {
      finishRecovery();
      return;
    }
    const r = list[replayCursor++];
    r.replayed = true;
    currentReplayLsn = r.lsn;
    if (r.kind === "update") {
      applyRecord(r);
      recoveryLog.push(
        `LSN ${r.lsn} update page ${r.pageId} = ${r.value} (txn ${r.txid}) — replayed`,
      );
    } else if (r.kind === "commit") {
      recoveryLog.push(`LSN ${r.lsn} commit txn ${r.txid} — replayed`);
    } else {
      recoveryLog.push(`LSN ${r.lsn} begin txn ${r.txid} — replayed`);
    }
    if (replayCursor >= list.length) {
      finishRecovery();
    }
  }

  function recoverAllImpl(): void {
    if (phase === "crashed") startRecoveryImpl();
    if (phase !== "recovering") return;
    // Bounded loop: replayList length is finite and replayCursor strictly advances.
    let guard = records.length + 4;
    while (phase === "recovering" && guard-- > 0) {
      recoverStepImpl();
    }
    if (phase === "recovering") finishRecovery();
  }

  function snapshotImpl(): WalSnapshot {
    const recordViews: WalRecordView[] = [...records]
      .sort((a, b) => a.lsn - b.lsn)
      .map((r) => {
        let durability: RecordDurability;
        if (r.torn) durability = "torn";
        else if (r.lsn <= lastDurableLsn) durability = "durable";
        else durability = "buffered";
        return {
          lsn: r.lsn,
          txid: r.txid,
          kind: r.kind,
          pageId: r.pageId,
          value: r.value,
          sizeBytes: r.sizeBytes,
          durability,
          replayed: r.replayed,
        };
      });

    const pages: PageView[] = [];
    for (let i = 0; i < PAGE_COUNT; i++) {
      pages.push({ pageId: i, memory: memoryPages[i], disk: diskPages[i] });
    }

    const txnViews: TxnView[] = txns.map((t) => ({
      txid: t.txid,
      status: t.status,
      commitLsn: t.commitLsn,
    }));

    return {
      phase,
      records: recordViews,
      lastLsn,
      lastDurableLsn,
      checkpointLsn,
      pages,
      txns: txnViews,
      fsyncCount,
      commitCount,
      flushInFlight: flush !== null,
      currentReplayLsn,
      recoveryLog: [...recoveryLog],
      acked: txns.filter((t) => t.status === "acked").length,
      survived: txns.filter((t) => t.status === "survived").length,
      lost: txns.filter((t) => t.status === "lost").length,
      fsyncOnCommit,
      loadOn,
    };
  }

  init();

  return {
    step: doStep,
    commit: doCommit,
    setLoad(on: boolean) {
      if (phase !== "running") return;
      loadOn = on;
      if (!on) loadTimerMs = 0;
    },
    setFsyncOnCommit(on: boolean) {
      if (phase !== "running") return;
      fsyncOnCommit = on;
    },
    checkpoint: doCheckpoint,
    crash: doCrash,
    startRecovery: startRecoveryImpl,
    recoverStep: recoverStepImpl,
    recoverAll: recoverAllImpl,
    reset: init,
    snapshot: snapshotImpl,
  };
}
