export type OrderStatus = "pending" | "charged" | "done";

export type WorkerPhase = "idle" | "charging" | "gap" | "emailing" | "email-gap" | "done";

export interface SweeperSnapshot {
  orderStatus: OrderStatus;
  chargeCount: number;
  emailCount: number;
  workerPhase: WorkerPhase;
  workerAlive: boolean;
  sweeperCountdownMs: number;
  sweeperIntervalMs: number;
  eventLog: string[];
  clockMs: number;
}

export interface SweeperSim {
  step(dtMs: number): void;
  start(): void;
  crashWorker(): void;
  restartWorker(): void;
  reset(): void;
  snapshot(): SweeperSnapshot;
}

export const SWEEPER_INTERVAL_MS = 2000;

const CHARGE_DURATION_MS = 600;
const GAP_DURATION_MS = 300;
const EMAIL_DURATION_MS = 400;
const EMAIL_GAP_DURATION_MS = 200;

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

export function createSweeperSim(seed: number): SweeperSim {
  let rng = mulberry32(seed);

  let orderStatus: OrderStatus;
  let chargeCount: number;
  let emailCount: number;
  let workerPhase: WorkerPhase;
  let workerAlive: boolean;
  let phaseRemainingMs: number;
  let sweeperCountdownMs: number;
  let eventLog: string[];
  let clockMs: number;

  function init(): void {
    rng = mulberry32(seed);
    orderStatus = "pending";
    chargeCount = 0;
    emailCount = 0;
    workerPhase = "idle";
    workerAlive = false;
    phaseRemainingMs = 0;
    // Seed the sweeper phase so different seeds start at different points in the cron cycle.
    sweeperCountdownMs = Math.floor(rng() * SWEEPER_INTERVAL_MS) + 1;
    eventLog = [];
    clockMs = 0;
  }

  function log(msg: string): void {
    eventLog.push(msg);
    if (eventLog.length > 20) eventLog.shift();
  }

  function fireSweeper(): void {
    if (orderStatus === "done") return;
    // Sweeper only picks up orphaned orders — it cannot tell whether a live worker
    // is currently between the side-effect and the status write (the gap it cannot see).
    if (workerAlive) {
      log("sweeper: fired — worker alive, skipping (order not orphaned)");
      return;
    }
    if (orderStatus === "pending") {
      chargeCount++;
      orderStatus = "charged";
      log(`sweeper: order was pending — fired chargeCard (charges: ${chargeCount}), wrote status=charged`);
    } else if (orderStatus === "charged") {
      emailCount++;
      orderStatus = "done";
      log(`sweeper: order was charged — fired sendEmail (emails: ${emailCount}), wrote status=done`);
    }
  }

  function advanceWorker(dtMs: number): void {
    if (!workerAlive) return;

    phaseRemainingMs -= dtMs;

    if (phaseRemainingMs > 0) return;

    const overflow = -phaseRemainingMs;

    switch (workerPhase) {
      case "charging": {
        // charge side effect done — increment count BEFORE writing status (the gap models this)
        chargeCount++;
        workerPhase = "gap";
        phaseRemainingMs = GAP_DURATION_MS - overflow;
        log(`worker: chargeCard done (charges: ${chargeCount}) — entering gap, status not yet written`);
        break;
      }
      case "gap": {
        orderStatus = "charged";
        workerPhase = "emailing";
        phaseRemainingMs = EMAIL_DURATION_MS - overflow;
        log("worker: wrote status=charged — starting sendEmail");
        break;
      }
      case "emailing": {
        emailCount++;
        workerPhase = "email-gap";
        phaseRemainingMs = EMAIL_GAP_DURATION_MS - overflow;
        log(`worker: sendEmail done (emails: ${emailCount}) — entering email-gap, status not yet written`);
        break;
      }
      case "email-gap": {
        orderStatus = "done";
        workerPhase = "done";
        workerAlive = false;
        phaseRemainingMs = 0;
        log("worker: wrote status=done — finished");
        break;
      }
      default:
        break;
    }
  }

  function doStep(dtMs: number): void {
    if (dtMs <= 0) return;
    clockMs += dtMs;

    advanceWorker(dtMs);

    sweeperCountdownMs -= dtMs;
    if (sweeperCountdownMs <= 0) {
      sweeperCountdownMs = SWEEPER_INTERVAL_MS + sweeperCountdownMs;
      if (sweeperCountdownMs < 0) sweeperCountdownMs = 0;
      fireSweeper();
    }
  }

  function doStart(): void {
    if (workerAlive) return;
    if (orderStatus === "done") return;
    workerAlive = true;
    workerPhase = "charging";
    phaseRemainingMs = CHARGE_DURATION_MS;
    log("worker: started — beginning chargeCard");
  }

  function doCrashWorker(): void {
    if (!workerAlive) return;
    log(`worker: crashed during phase=${workerPhase} — in-memory state lost, DB unchanged`);
    workerAlive = false;
    workerPhase = "done";
  }

  function doRestartWorker(): void {
    if (workerAlive) return;
    if (orderStatus === "done") return;
    workerAlive = true;
    workerPhase = "charging";
    phaseRemainingMs = CHARGE_DURATION_MS;
    log("worker: restarted — retrying from chargeCard");
  }

  function snapshotImpl(): SweeperSnapshot {
    return {
      orderStatus,
      chargeCount,
      emailCount,
      workerPhase,
      workerAlive,
      sweeperCountdownMs,
      sweeperIntervalMs: SWEEPER_INTERVAL_MS,
      eventLog: [...eventLog],
      clockMs,
    };
  }

  init();

  return {
    step: doStep,
    start: doStart,
    crashWorker: doCrashWorker,
    restartWorker: doRestartWorker,
    reset: init,
    snapshot: snapshotImpl,
  };
}
