export type CommitRate = 10 | 50 | 200;

export interface LaneSnapshot {
  queueDepth: number;
  completed: number;
  commitsPerSecRolling: number;
  fsyncsIssued: number;
}

export interface NaiveVsWalSnapshot {
  naive: LaneSnapshot;
  wal: LaneSnapshot;
  elapsedMs: number;
  rate: CommitRate;
}

export interface NaiveVsWalSim {
  step(dtMs: number): void;
  setRate(rate: CommitRate): void;
  reset(): void;
  snapshot(): NaiveVsWalSnapshot;
}

const FSYNC_COST_MS = 5;
const ROLLING_WINDOW_MS = 1000;

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

interface NaiveCommit {
  totalCostMs: number;
  servedMs: number;
  pagesCount: number;
}

export function createNaiveVsWalSim(seed: number): NaiveVsWalSim {
  let rng = mulberry32(seed);

  let rate: CommitRate;
  let elapsedMs: number;

  // naive lane: each commit drains serialized fsyncs (pages * FSYNC_COST_MS ms total)
  let naiveQueue: NaiveCommit[];
  let naiveCompleted: number;
  let naiveFsyncs: number;
  let naiveCompletedTimestamps: number[];

  // WAL lane: commits arrive into a window; every FSYNC_COST_MS the window drains
  let walPending: number;
  let walCompleted: number;
  let walFsyncs: number;
  let walWindowElapsed: number;
  let walCompletedTimestamps: number[];

  let commitAccumMs: number;

  function init(): void {
    rng = mulberry32(seed);
    rate = 10;
    elapsedMs = 0;

    naiveQueue = [];
    naiveCompleted = 0;
    naiveFsyncs = 0;
    naiveCompletedTimestamps = [];

    walPending = 0;
    walCompleted = 0;
    walFsyncs = 0;
    walWindowElapsed = 0;
    walCompletedTimestamps = [];

    commitAccumMs = 0;
  }

  function rollingCount(timestamps: number[], nowMs: number): number {
    const cutoff = nowMs - ROLLING_WINDOW_MS;
    let count = 0;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if ((timestamps[i] ?? 0) > cutoff) count++;
      else break;
    }
    return count;
  }

  function pruneOld(timestamps: number[], nowMs: number): number[] {
    const cutoff = nowMs - ROLLING_WINDOW_MS;
    let i = 0;
    while (i < timestamps.length && (timestamps[i] ?? 0) <= cutoff) i++;
    return i === 0 ? timestamps : timestamps.slice(i);
  }

  function pagesTouched(): number {
    return 1 + Math.floor(rng() * 3);
  }

  function enqueueCommit(): void {
    const pages = pagesTouched();
    const totalCost = pages * FSYNC_COST_MS;
    naiveQueue.push({ totalCostMs: totalCost, servedMs: 0, pagesCount: pages });
    walPending += 1;
  }

  function advanceNaive(dtMs: number): void {
    let remaining = dtMs;
    while (remaining > 0 && naiveQueue.length > 0) {
      const head = naiveQueue[0];
      if (!head) break;
      const needed = head.totalCostMs - head.servedMs;
      if (remaining >= needed) {
        remaining -= needed;
        naiveQueue.shift();
        naiveCompleted += 1;
        naiveFsyncs += head.pagesCount;
        naiveCompletedTimestamps.push(elapsedMs);
      } else {
        head.servedMs += remaining;
        remaining = 0;
      }
    }
  }

  function advanceWal(dtMs: number): void {
    let remaining = dtMs;
    while (remaining > 0) {
      const tillNextFsync = FSYNC_COST_MS - walWindowElapsed;
      if (remaining >= tillNextFsync) {
        remaining -= tillNextFsync;
        walWindowElapsed = 0;
        if (walPending > 0) {
          walCompleted += walPending;
          for (let i = 0; i < walPending; i++) {
            walCompletedTimestamps.push(elapsedMs - remaining);
          }
          walFsyncs += 1;
          walPending = 0;
        }
      } else {
        walWindowElapsed += remaining;
        remaining = 0;
      }
    }
  }

  function doStep(dtMs: number): void {
    if (dtMs <= 0) return;

    const intervalMs = 1000 / rate;
    commitAccumMs += dtMs;
    while (commitAccumMs >= intervalMs) {
      commitAccumMs -= intervalMs;
      enqueueCommit();
    }

    elapsedMs += dtMs;

    advanceNaive(dtMs);
    advanceWal(dtMs);

    naiveCompletedTimestamps = pruneOld(naiveCompletedTimestamps, elapsedMs);
    walCompletedTimestamps = pruneOld(walCompletedTimestamps, elapsedMs);
  }

  function snapshotImpl(): NaiveVsWalSnapshot {
    return {
      naive: {
        queueDepth: naiveQueue.length,
        completed: naiveCompleted,
        commitsPerSecRolling: rollingCount(naiveCompletedTimestamps, elapsedMs),
        fsyncsIssued: naiveFsyncs,
      },
      wal: {
        queueDepth: walPending,
        completed: walCompleted,
        commitsPerSecRolling: rollingCount(walCompletedTimestamps, elapsedMs),
        fsyncsIssued: walFsyncs,
      },
      elapsedMs,
      rate,
    };
  }

  init();

  return {
    step: doStep,
    setRate(r: CommitRate) {
      rate = r;
    },
    reset: init,
    snapshot: snapshotImpl,
  };
}
