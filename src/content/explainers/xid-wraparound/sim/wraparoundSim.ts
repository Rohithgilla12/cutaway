// All xid quantities are in units of one million transactions (M), so the
// numbers match Postgres's documented defaults read in millions: the usable
// space before wraparound is 2^31 ≈ 2147M, autovacuum_freeze_max_age is 200M,
// vacuum_freeze_min_age is 50M, warnings begin ~40M from the wall, and the
// system refuses new xids ~3M from the wall.
export const WRAP_SPACE = 2147; // 2^31 transactions, in M
export const FREEZE_MAX_AGE = 200; // autovacuum_freeze_max_age default, in M
export const FREEZE_MIN_AGE = 50; // vacuum_freeze_min_age default, in M
export const WARN_REMAINING = 40; // warnings begin this far from wraparound
export const REFUSE_REMAINING = 3; // commands refused this far from wraparound
export const AGE_WARN = WRAP_SPACE - WARN_REMAINING; // 2107
export const AGE_REFUSE = WRAP_SPACE - REFUSE_REMAINING; // 2144

export const BOOTSTRAP_RELFROZEN = 250;
export const BOOTSTRAP_NEXTXID = BOOTSTRAP_RELFROZEN + FREEZE_MIN_AGE; // healthy steady state

export type ClusterStatus = "healthy" | "forcing" | "warning" | "refusing";

export interface FreezeReport {
  trigger: "manual" | "auto" | "auto-forced";
  ageBefore: number;
  ageAfter: number;
  relfrozenAdvanced: number;
  stuck: boolean; // freeze ran but the pinned horizon blocked relfrozenxid from advancing
}

export interface WraparoundSnapshot {
  nextXid: number;
  relfrozenXid: number;
  oldestXmin: number; // the freeze horizon: pinned snapshot's xmin, or nextXid
  pinnedXmin: number | null;
  pinnedForXids: number | null; // how many xids burned since the snapshot was taken
  age: number; // nextXid - relfrozenXid (age of the oldest unfrozen xid)
  remaining: number; // WRAP_SPACE - age
  status: ClusterStatus;
  workload: boolean;
  autoVacuum: boolean;
  totalBurned: number;
  lastFreeze: FreezeReport | null;
  // Geometry helpers for the ring view, all as fractions of WRAP_SPACE.
  relfrozenFrac: number;
  nextXidFrac: number;
  pinnedFrac: number | null;
  eventLog: string[];
}

export interface WraparoundSim {
  step(dtMs: number): void;
  burnXids(amount: number): void;
  setWorkload(on: boolean): void;
  setAutoVacuum(on: boolean): void;
  freeze(): void; // manual VACUUM FREEZE
  pinSnapshot(): void;
  releaseSnapshot(): void;
  reset(): void;
  snapshot(): WraparoundSnapshot;
}

export const SIMPLIFICATIONS: readonly string[] = [
  "One number stands for the whole cluster's oldest xid. Real Postgres tracks relfrozenxid per table and datfrozenxid per database; the cluster's exposure is the minimum over all of them, and the table holding the oldest one is what you must vacuum.",
  "Xids are in millions and the space is 2147M (= 2^31). Real xids are individual 32-bit integers compared modulo 2^32 with a signed comparison, which is what makes the space behave as a circle.",
  "Freezing is modeled as relfrozenxid jumping to a cutoff. Real vacuum scans pages, sets the frozen bit on individual tuples (or whole pages via the visibility map), and only an aggressive/anti-wraparound vacuum is guaranteed to advance relfrozenxid.",
  "The freeze horizon here is exactly the pinned snapshot's xmin (or nextXid when none is held). Real Postgres takes a minimum over every backend xmin, replication slot, prepared transaction, and hot-standby feedback — the same machinery that pins the dead-tuple horizon.",
  "The workload only consumes xids. It does not model the dead-tuple bloat that the same pinned horizon causes in parallel (that is the MVCC explainer); here we watch only the freeze/age axis.",
  "Recovery is a single freeze. The real single-user-mode ritual is `postgres --single`, a VACUUM, and care to first release whatever was holding the horizon.",
];

export function createWraparoundSim(): WraparoundSim {
  let nextXid: number;
  let relfrozenXid: number;
  let pinnedXmin: number | null;
  let workload: boolean;
  let autoVacuum: boolean;
  let burnTimerMs: number;
  let totalBurned: number;
  let lastFreeze: FreezeReport | null;
  let prevStatus: ClusterStatus;
  let eventLog: string[];

  const BURN_INTERVAL_MS = 100;
  const BURN_PER_INTERVAL = 20; // 200 M xids/s of simulated workload

  function log(line: string): void {
    eventLog.push(line);
    if (eventLog.length > 60) eventLog.shift();
  }

  function init(): void {
    nextXid = BOOTSTRAP_NEXTXID;
    relfrozenXid = BOOTSTRAP_RELFROZEN;
    pinnedXmin = null;
    workload = false;
    autoVacuum = false;
    burnTimerMs = 0;
    totalBurned = 0;
    lastFreeze = null;
    prevStatus = "healthy";
    eventLog = [];
  }

  const STATUS_LOG: Record<ClusterStatus, string> = {
    healthy: "age back in the safe band — freezing is keeping up",
    forcing: "age ≥ autovacuum_freeze_max_age (200M): Postgres forces an anti-wraparound autovacuum even if autovacuum is off",
    warning: "WARNING: database must be vacuumed within fewer transactions — wraparound is approaching",
    refusing:
      "ERROR: database is not accepting commands that assign new XIDs to avoid wraparound data loss — recover with a database-wide VACUUM",
  };

  function oldestXmin(): number {
    return pinnedXmin ?? nextXid;
  }

  function age(): number {
    return nextXid - relfrozenXid;
  }

  function status(): ClusterStatus {
    const a = age();
    if (a >= AGE_REFUSE) return "refusing";
    if (a >= AGE_WARN) return "warning";
    if (a >= FREEZE_MAX_AGE) return "forcing";
    return "healthy";
  }

  function doFreeze(trigger: FreezeReport["trigger"]): void {
    const ageBefore = age();
    // The freeze cutoff: don't bother with the most recent FREEZE_MIN_AGE of
    // xids, and never advance past the oldest xmin any snapshot still needs.
    const cutoff = Math.min(nextXid - FREEZE_MIN_AGE, oldestXmin());
    const before = relfrozenXid;
    relfrozenXid = Math.max(relfrozenXid, cutoff);
    const advanced = relfrozenXid - before;
    const ageAfter = age();
    const stuck = pinnedXmin !== null && cutoff <= pinnedXmin && ageAfter > FREEZE_MIN_AGE;
    lastFreeze = { trigger, ageBefore, ageAfter, relfrozenAdvanced: advanced, stuck };
    // Manual freezes always narrate; auto/forced ones run silently and let the
    // status transitions in step() tell the story (avoids per-tick log spam).
    if (trigger === "manual") {
      log(
        stuck
          ? `VACUUM FREEZE: relfrozenxid stuck at ${relfrozenXid} (pinned horizon ${pinnedXmin}) — age still ${ageAfter}M`
          : `VACUUM FREEZE: relfrozenxid ${before} → ${relfrozenXid}, age ${ageBefore}M → ${ageAfter}M`,
      );
    }
    checkStatus();
  }

  function checkStatus(): void {
    const s = status();
    if (s !== prevStatus) {
      log(STATUS_LOG[s]);
      prevStatus = s;
    }
  }

  function doBurn(amount: number): void {
    if (amount <= 0) return;
    if (status() === "refusing") {
      log(`write refused: not accepting commands that assign new XIDs to avoid wraparound (age ${age()}M)`);
      return;
    }
    nextXid += amount;
    totalBurned += amount;
    checkStatus();
  }

  function maybeForceVacuum(): void {
    // Anti-wraparound autovacuum is launched once age reaches
    // autovacuum_freeze_max_age, even if autovacuum is otherwise disabled.
    if (age() >= FREEZE_MAX_AGE) {
      doFreeze("auto-forced");
    } else if (autoVacuum) {
      // A routine autovacuum also freezes opportunistically in the healthy band.
      doFreeze("auto");
    }
  }

  function doStep(dtMs: number): void {
    if (dtMs <= 0) return;
    if (workload) {
      burnTimerMs += dtMs;
      let guard = 100000;
      while (burnTimerMs >= BURN_INTERVAL_MS && guard-- > 0) {
        burnTimerMs -= BURN_INTERVAL_MS;
        doBurn(BURN_PER_INTERVAL);
      }
    }
    maybeForceVacuum();
    checkStatus();
  }

  function snapshotImpl(): WraparoundSnapshot {
    const a = age();
    const ox = oldestXmin();
    return {
      nextXid,
      relfrozenXid,
      oldestXmin: ox,
      pinnedXmin,
      pinnedForXids: pinnedXmin !== null ? nextXid - pinnedXmin : null,
      age: a,
      remaining: WRAP_SPACE - a,
      status: status(),
      workload,
      autoVacuum,
      totalBurned,
      lastFreeze: lastFreeze ? { ...lastFreeze } : null,
      relfrozenFrac: (relfrozenXid % WRAP_SPACE) / WRAP_SPACE,
      nextXidFrac: (nextXid % WRAP_SPACE) / WRAP_SPACE,
      pinnedFrac: pinnedXmin !== null ? (pinnedXmin % WRAP_SPACE) / WRAP_SPACE : null,
      eventLog: [...eventLog],
    };
  }

  init();

  return {
    step: doStep,
    burnXids: doBurn,
    setWorkload(on: boolean) {
      workload = on;
      if (!on) burnTimerMs = 0;
    },
    setAutoVacuum(on: boolean) {
      autoVacuum = on;
    },
    freeze() {
      doFreeze("manual");
    },
    pinSnapshot() {
      if (pinnedXmin !== null) return;
      pinnedXmin = nextXid;
      log(`BEGIN — snapshot pins the freeze horizon at xid ${pinnedXmin}`);
    },
    releaseSnapshot() {
      if (pinnedXmin === null) return;
      const held = pinnedXmin;
      pinnedXmin = null;
      log(`COMMIT — freeze horizon released (was pinned at ${held}, now ${nextXid})`);
    },
    reset: init,
    snapshot: snapshotImpl,
  };
}
