import { visibleToSnapshot, classifyTuple, type TupleFate } from "./visibility";

export const ROW_COUNT = 8;
export const PAGE_CAPACITY = 4;
export const DISK_PAGE_CAP = 16;
export const BOOTSTRAP_XID = 100;
export const AUTO_UPDATE_INTERVAL_MS = 250; // ~4 updates/s
export const AUTOVACUUM_NAPTIME_MS = 2000;
export const AUTOVACUUM_BASE_THRESHOLD = 4; // scaled-down autovacuum_vacuum_threshold
export const AUTOVACUUM_SCALE_FACTOR = 0.2; // matches autovacuum_vacuum_scale_factor default
export const HORIZON_AGE_DANGER = 50;

export interface TupleView {
  page: number;
  slot: number;
  rowId: number;
  version: number;
  xmin: number;
  xmax: number; // 0 == no deleter, tuple is the row's current version
  fate: TupleFate;
  visibleToSnapshot: boolean; // false when no long transaction is open
}

export interface PageView {
  index: number;
  slots: (TupleView | null)[]; // null == free slot (reusable space)
}

export interface RowView {
  rowId: number;
  latestVersion: number;
  snapshotVersion: number | null; // what the held snapshot sees; null when none open
}

export interface VacuumReport {
  trigger: "manual" | "auto";
  removed: number;
  kept: number; // dead but not removable yet
  truncatedPages: number;
  oldestXmin: number;
}

export interface MvccSnapshot {
  pages: PageView[];
  rows: RowView[];
  longTxn: { snapshotXmin: number; heldForXids: number } | null;
  nextXid: number;
  horizonXid: number;
  horizonAgeXids: number;
  liveCount: number;
  deadRemovable: number;
  deadPinned: number;
  deadTotal: number;
  freeSlots: number;
  pageCount: number;
  minPagesNeeded: number;
  bloatRatio: number;
  diskFull: boolean;
  autovacuumThreshold: number;
  autoUpdate: boolean;
  autoVacuum: boolean;
  totalUpdates: number;
  lastVacuum: VacuumReport | null;
  eventLog: string[];
}

export interface MvccSim {
  step(dtMs: number): void;
  update(rowId?: number): boolean; // false when refused (disk full)
  setAutoUpdate(on: boolean): void;
  vacuum(): void;
  setAutoVacuum(on: boolean): void;
  openLongTxn(): void;
  closeLongTxn(): void;
  reset(): void;
  snapshot(): MvccSnapshot;
}

export const SIMPLIFICATIONS: readonly string[] = [
  "Every workload UPDATE is its own single-statement transaction that commits the instant it gets an xid. No aborts, so visibility never has to consult commit status (CLOG) and there are no aborted-tuple leftovers.",
  "The long transaction is read-only REPEATABLE READ: one snapshot taken at open, held until commit, and no xid of its own (real read-only transactions are not assigned one either). Its snapshot xmin is what pins the horizon.",
  "The vacuum horizon is exactly the open snapshot's xmin, or the next xid when nothing is open. Real Postgres computes the minimum over every backend's xmin/xid plus replication slots and prepared transactions (ComputeXidHorizons).",
  "No HOT updates and no opportunistic page pruning: every new version takes any free slot table-wide, and only VACUUM reclaims dead ones. Real Postgres tries to keep update chains on the same page and can prune them without vacuum.",
  "No indexes. Real vacuum makes index passes, and dead index entries are their own bloat story.",
  "Pages hold 4 tuples and the table is capped at 16 pages so runaway bloat hits 'disk full' in seconds. Real pages are 8 KB and hold dozens to hundreds of tuples.",
  "Xids are small integers with no wraparound or freezing. The horizon-age meter stands in for the wraparound clock; the real one runs to ~2^31.",
  "VACUUM is instantaneous and free. Real vacuum does I/O and is throttled by cost-based delay; falling behind has causes other than a pinned horizon.",
  "Free space is reused first-fit by slot order rather than via the free space map.",
  "Pure UPDATE workload on a fixed set of 8 rows — no INSERT or DELETE — so every dead tuple is a superseded version and the live count is constant.",
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

interface Tuple {
  rowId: number;
  version: number;
  xmin: number;
  xmax: number; // 0 == live
}

export function createMvccSim(seed: number): MvccSim {
  let rng = mulberry32(seed);

  let pages: (Tuple | null)[][];
  let nextXid: number;
  let longTxn: { snapshotXmin: number } | null;
  let autoUpdate: boolean;
  let autoVacuum: boolean;
  let updateTimerMs: number;
  let napTimerMs: number;
  let totalUpdates: number;
  let lastVacuum: VacuumReport | null;
  let eventLog: string[];

  function init(): void {
    rng = mulberry32(seed);
    pages = [];
    // Bootstrap: 8 rows at version 1, inserted by one pre-history xid.
    for (let r = 0; r < ROW_COUNT; r++) {
      placeTuple({ rowId: r, version: 1, xmin: BOOTSTRAP_XID, xmax: 0 });
    }
    nextXid = BOOTSTRAP_XID + 1;
    longTxn = null;
    autoUpdate = false;
    autoVacuum = false;
    updateTimerMs = 0;
    napTimerMs = 0;
    totalUpdates = 0;
    lastVacuum = null;
    eventLog = [];
  }

  function log(line: string): void {
    eventLog.push(line);
    if (eventLog.length > 60) eventLog.shift();
  }

  function horizonXid(): number {
    return longTxn ? longTxn.snapshotXmin : nextXid;
  }

  function* allTuples(): Generator<Tuple> {
    for (const page of pages) {
      for (const t of page) if (t !== null) yield t;
    }
  }

  function freeSlotCount(): number {
    let n = 0;
    for (const page of pages) for (const t of page) if (t === null) n += 1;
    return n;
  }

  // First-fit: the first free slot in page order, else a fresh page if the
  // disk cap allows. Returns false when the table is full.
  function placeTuple(t: Tuple): boolean {
    for (const page of pages) {
      const i = page.indexOf(null);
      if (i !== -1) {
        page[i] = t;
        return true;
      }
    }
    if (pages.length >= DISK_PAGE_CAP) return false;
    const page: (Tuple | null)[] = new Array(PAGE_CAPACITY).fill(null);
    page[0] = t;
    pages.push(page);
    return true;
  }

  function liveTupleOf(rowId: number): Tuple {
    for (const t of allTuples()) {
      if (t.rowId === rowId && t.xmax === 0) return t;
    }
    throw new Error(`row ${rowId} has no live tuple — sim invariant broken`);
  }

  function doUpdate(rowId?: number): boolean {
    const row = rowId !== undefined ? rowId : Math.floor(rng() * ROW_COUNT);
    if (freeSlotCount() === 0 && pages.length >= DISK_PAGE_CAP) {
      log(`UPDATE r${row} refused — table at ${DISK_PAGE_CAP}-page cap (disk full), nothing reclaimable`);
      return false;
    }
    const old = liveTupleOf(row);
    const xid = nextXid++;
    old.xmax = xid;
    placeTuple({ rowId: row, version: old.version + 1, xmin: xid, xmax: 0 });
    totalUpdates += 1;
    return true;
  }

  function doVacuum(trigger: "manual" | "auto"): void {
    const oldestXmin = horizonXid();
    let removed = 0;
    let kept = 0;
    for (const page of pages) {
      for (let i = 0; i < page.length; i++) {
        const t = page[i];
        if (t === null || t.xmax === 0) continue;
        if (classifyTuple(t.xmax, oldestXmin) === "dead-removable") {
          page[i] = null;
          removed += 1;
        } else {
          kept += 1;
        }
      }
    }
    // Like real lazy vacuum, file space only returns to the OS when trailing
    // pages end up empty — interior free space is merely reusable.
    let truncatedPages = 0;
    while (pages.length > 0 && pages[pages.length - 1].every((t) => t === null)) {
      pages.pop();
      truncatedPages += 1;
    }
    lastVacuum = { trigger, removed, kept, truncatedPages, oldestXmin };
    log(
      `VACUUM${trigger === "auto" ? " (autovacuum)" : ""}: removed ${removed} dead, ` +
        `${kept} dead cannot be removed yet (oldest xmin = ${oldestXmin})` +
        (truncatedPages ? `, truncated ${truncatedPages} trailing page${truncatedPages > 1 ? "s" : ""}` : ""),
    );
  }

  function deadCount(): number {
    let n = 0;
    for (const t of allTuples()) if (t.xmax !== 0) n += 1;
    return n;
  }

  function autovacuumThreshold(): number {
    return AUTOVACUUM_BASE_THRESHOLD + Math.ceil(AUTOVACUUM_SCALE_FACTOR * ROW_COUNT);
  }

  function doStep(dtMs: number): void {
    if (dtMs <= 0) return;
    if (autoUpdate) {
      updateTimerMs += dtMs;
      let guard = 10000;
      while (updateTimerMs >= AUTO_UPDATE_INTERVAL_MS && guard-- > 0) {
        updateTimerMs -= AUTO_UPDATE_INTERVAL_MS;
        doUpdate();
      }
    }
    if (autoVacuum) {
      napTimerMs += dtMs;
      let guard = 10000;
      while (napTimerMs >= AUTOVACUUM_NAPTIME_MS && guard-- > 0) {
        napTimerMs -= AUTOVACUUM_NAPTIME_MS;
        if (deadCount() >= autovacuumThreshold()) doVacuum("auto");
      }
    }
  }

  function snapshotImpl(): MvccSnapshot {
    const horizon = horizonXid();
    const snapXmin = longTxn?.snapshotXmin ?? null;

    const pageViews: PageView[] = pages.map((page, pi) => ({
      index: pi,
      slots: page.map((t, si) =>
        t === null
          ? null
          : {
              page: pi,
              slot: si,
              rowId: t.rowId,
              version: t.version,
              xmin: t.xmin,
              xmax: t.xmax,
              fate: classifyTuple(t.xmax, horizon),
              visibleToSnapshot: snapXmin !== null && visibleToSnapshot(t.xmin, t.xmax, snapXmin),
            },
      ),
    }));

    const rows: RowView[] = [];
    for (let r = 0; r < ROW_COUNT; r++) {
      let latestVersion = 0;
      let snapshotVersion: number | null = null;
      for (const t of allTuples()) {
        if (t.rowId !== r) continue;
        if (t.xmax === 0) latestVersion = t.version;
        if (snapXmin !== null && visibleToSnapshot(t.xmin, t.xmax, snapXmin)) snapshotVersion = t.version;
      }
      rows.push({ rowId: r, latestVersion, snapshotVersion });
    }

    let liveCount = 0;
    let deadRemovable = 0;
    let deadPinned = 0;
    for (const t of allTuples()) {
      const fate = classifyTuple(t.xmax, horizon);
      if (fate === "live") liveCount += 1;
      else if (fate === "dead-removable") deadRemovable += 1;
      else deadPinned += 1;
    }

    const minPagesNeeded = Math.max(1, Math.ceil(liveCount / PAGE_CAPACITY));
    const freeSlots = freeSlotCount();

    return {
      pages: pageViews,
      rows,
      longTxn: longTxn ? { snapshotXmin: longTxn.snapshotXmin, heldForXids: nextXid - longTxn.snapshotXmin } : null,
      nextXid,
      horizonXid: horizon,
      horizonAgeXids: nextXid - horizon,
      liveCount,
      deadRemovable,
      deadPinned,
      deadTotal: deadRemovable + deadPinned,
      freeSlots,
      pageCount: pages.length,
      minPagesNeeded,
      bloatRatio: pages.length / minPagesNeeded,
      diskFull: freeSlots === 0 && pages.length >= DISK_PAGE_CAP,
      autovacuumThreshold: autovacuumThreshold(),
      autoUpdate,
      autoVacuum,
      totalUpdates,
      lastVacuum: lastVacuum ? { ...lastVacuum } : null,
      eventLog: [...eventLog],
    };
  }

  init();

  return {
    step: doStep,
    update: doUpdate,
    setAutoUpdate(on: boolean) {
      autoUpdate = on;
      if (!on) updateTimerMs = 0;
    },
    vacuum() {
      doVacuum("manual");
    },
    setAutoVacuum(on: boolean) {
      autoVacuum = on;
      if (!on) napTimerMs = 0;
    },
    openLongTxn() {
      if (longTxn) return;
      longTxn = { snapshotXmin: nextXid };
      log(`BEGIN ISOLATION LEVEL REPEATABLE READ — snapshot xmin = ${longTxn.snapshotXmin}, horizon pinned`);
    },
    closeLongTxn() {
      if (!longTxn) return;
      const held = longTxn.snapshotXmin;
      longTxn = null;
      log(`COMMIT — oldest xmin advances ${held} → ${nextXid}, dead tuples behind it become removable`);
    },
    reset: init,
    snapshot: snapshotImpl,
  };
}
