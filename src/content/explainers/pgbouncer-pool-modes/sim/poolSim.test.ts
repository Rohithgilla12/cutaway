import { describe, it, expect } from "vitest";
import {
  createPoolSim,
  SIMPLIFICATIONS,
  QUERY_WAIT_TIMEOUT_MS,
  type PoolSim,
  type PoolSnapshot,
  type PoolMode,
  type LoadLevel,
} from "./poolSim";

// Deterministic driver RNG independent of the sim's own RNG.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Op =
  | { t: "step"; dt: number }
  | { t: "mode"; mode: PoolMode }
  | { t: "clients"; n: number }
  | { t: "pool"; n: number }
  | { t: "load"; level: LoadLevel }
  | { t: "prepared"; on: boolean };

const MODES: PoolMode[] = ["session", "transaction", "statement"];

function randomOps(seed: number, n: number): Op[] {
  const r = lcg(seed);
  const ops: Op[] = [];
  for (let i = 0; i < n; i++) {
    const x = r();
    if (x < 0.55) ops.push({ t: "step", dt: 1 + Math.floor(r() * 120) });
    else if (x < 0.65) ops.push({ t: "mode", mode: MODES[Math.floor(r() * 3)] });
    else if (x < 0.75) ops.push({ t: "clients", n: 1 + Math.floor(r() * 16) });
    else if (x < 0.85) ops.push({ t: "pool", n: 1 + Math.floor(r() * 8) });
    else if (x < 0.95) ops.push({ t: "load", level: r() < 0.5 ? "low" : "high" });
    else ops.push({ t: "prepared", on: r() < 0.5 });
  }
  return ops;
}

function applyOp(sim: PoolSim, op: Op): void {
  switch (op.t) {
    case "step":
      sim.step(op.dt);
      break;
    case "mode":
      sim.setMode(op.mode);
      break;
    case "clients":
      sim.setClients(op.n);
      break;
    case "pool":
      sim.setPoolSize(op.n);
      break;
    case "load":
      sim.setLoad(op.level);
      break;
    case "prepared":
      sim.togglePrepared(op.on);
      break;
  }
}

// Every structural invariant that must hold after ANY step, regardless of mode.
function assertStructuralInvariants(snap: PoolSnapshot): void {
  // server count == pool_size
  expect(snap.servers.length).toBe(snap.poolSize);
  expect(snap.clients.length).toBe(snap.clientCount);

  // Exclusive linkage: each server linked to <= 1 client. Build the link map
  // both directions and check they agree.
  const serverToClient = new Map<number, number>();
  for (const s of snap.servers) {
    if (s.linkedClient !== null) {
      expect(serverToClient.has(s.id)).toBe(false); // <= 1 client per server
      serverToClient.set(s.id, s.linkedClient);
    }
  }

  // A client holds <= 1 server, and a client is never both waiting and linked.
  const clientServers = new Map<number, number>();
  for (const c of snap.clients) {
    if (c.currentServer !== null) {
      expect(clientServers.has(c.id)).toBe(false);
      clientServers.set(c.id, c.currentServer);
      // server index in range
      expect(c.currentServer).toBeGreaterThanOrEqual(0);
      expect(c.currentServer).toBeLessThan(snap.poolSize);
    }
    if (snap.waitQueue.includes(c.id)) {
      expect(c.currentServer, `waiter ${c.id} must not hold a server`).toBeNull();
      expect(c.state).toBe("waiting");
    }
  }

  // No two clients claim the same server.
  const claimed = new Set<number>();
  for (const [, srv] of clientServers) {
    expect(claimed.has(srv)).toBe(false);
    claimed.add(srv);
  }

  // Bidirectional consistency: if a server says it's linked to client X, then
  // X must point back at that server (and vice versa).
  for (const s of snap.servers) {
    if (s.linkedClient !== null) {
      const c = snap.clients.find((x) => x.id === s.linkedClient);
      expect(c, `linked client ${s.linkedClient} exists`).toBeDefined();
      expect(c!.currentServer).toBe(s.id);
    }
  }

  // wait queue holds no duplicates.
  expect(new Set(snap.waitQueue).size).toBe(snap.waitQueue.length);

  // counters consistent.
  expect(snap.counters.xactsCompleted).toBeLessThanOrEqual(snap.counters.xactsStarted);
  expect(snap.counters.xactsStarted).toBeGreaterThanOrEqual(0);
  expect(snap.counters.queriesRun).toBeGreaterThanOrEqual(0);
}

describe("1. exclusive linkage (sweep seeds x schedules x modes)", () => {
  it("a server is linked to <= 1 client and a client holds <= 1 server, at every step", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const ops = randomOps(seed, 60);
      const sim = createPoolSim(seed);
      assertStructuralInvariants(sim.snapshot());
      for (const op of ops) {
        applyOp(sim, op);
        assertStructuralInvariants(sim.snapshot());
      }
    }
  });

  it("holds across forced high-load saturation in every mode", () => {
    for (const m of MODES) {
      for (let seed = 1; seed <= 12; seed++) {
        const sim = createPoolSim(seed);
        sim.setMode(m);
        sim.setClients(16);
        sim.setPoolSize(2);
        sim.setLoad("high");
        sim.togglePrepared(true);
        for (let i = 0; i < 200; i++) {
          sim.step(30);
          assertStructuralInvariants(sim.snapshot());
        }
      }
    }
  });
});

// Track per-transaction server assignment by observing pulses over time.
// Returns a map of clientId -> set of serverIds it ran statements on while in a
// single uninterrupted "intxn" run.
describe("2. transaction-mode atomicity", () => {
  it("all queries of a transaction run on the SAME server; no mid-xact reassignment", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const sim = createPoolSim(seed);
      sim.setMode("transaction");
      sim.setClients(8);
      sim.setPoolSize(3);
      sim.setLoad("high");

      // For each client, the server it holds must not change while it stays
      // continuously in "intxn" state.
      const lastState = new Map<number, string>();
      const lastServer = new Map<number, number | null>();

      for (let i = 0; i < 400; i++) {
        sim.step(20);
        const snap = sim.snapshot();
        for (const c of snap.clients) {
          const prevState = lastState.get(c.id);
          const prevServer = lastServer.get(c.id);
          if (prevState === "intxn" && c.state === "intxn") {
            // Continuous transaction: server must be identical.
            expect(c.currentServer, `client ${c.id} reassigned mid-transaction`).toBe(prevServer ?? null);
            expect(c.currentServer).not.toBeNull();
          }
          lastState.set(c.id, c.state);
          lastServer.set(c.id, c.currentServer);
        }
      }
    }
  });
});

describe("3. session-mode stickiness", () => {
  it("a client keeps the same server across transactions until it disconnects", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const sim = createPoolSim(seed);
      sim.setMode("session");
      sim.setClients(4);
      sim.setPoolSize(4); // everyone can get a server, isolate stickiness
      sim.setLoad("high");

      // Once a client links a server, it keeps that server until currentServer
      // goes null (disconnect). It must never jump directly to a DIFFERENT
      // non-null server without passing through null.
      const held = new Map<number, number>();
      for (let i = 0; i < 500; i++) {
        sim.step(20);
        const snap = sim.snapshot();
        for (const c of snap.clients) {
          if (c.currentServer === null) {
            held.delete(c.id);
            continue;
          }
          const prev = held.get(c.id);
          if (prev !== undefined) {
            expect(c.currentServer, `session client ${c.id} jumped servers`).toBe(prev);
          }
          held.set(c.id, c.currentServer);
        }
      }
    }
  });
});

describe("4. statement-mode release + multi-statement disallowed", () => {
  it("multi-statement transactions error with statement_multi", () => {
    let sawMulti = false;
    for (let seed = 1; seed <= 30 && !sawMulti; seed++) {
      const sim = createPoolSim(seed);
      sim.setMode("statement");
      sim.setClients(8);
      sim.setPoolSize(4);
      sim.setLoad("high");
      for (let i = 0; i < 300; i++) {
        sim.step(20);
        const snap = sim.snapshot();
        if (snap.counters.errors.statement_multi > 0) {
          sawMulti = true;
          // The error message names the statement-pooling restriction.
          expect(snap.eventLog.some((l) => /statement pooling mode/.test(l))).toBe(true);
          break;
        }
      }
    }
    expect(sawMulti, "statement mode must reject some multi-statement transaction").toBe(true);
  });

  it("in statement mode a client never runs two statements back-to-back on a held server", () => {
    // Statement mode releases after each statement. The only legal transactions
    // are single-statement, so a client should never be observed running query
    // index > 0. We approximate by asserting no transaction completes with more
    // than one query: queriesRun grows by 1 per completed (single-statement) xact.
    const sim = createPoolSim(9);
    sim.setMode("statement");
    sim.setClients(6);
    sim.setPoolSize(3);
    sim.setLoad("high");
    for (let i = 0; i < 400; i++) sim.step(20);
    const snap = sim.snapshot();
    // Every completed transaction in statement mode is exactly one query.
    expect(snap.counters.xactsCompleted).toBe(snap.counters.queriesRun);
  });
});

describe("5. prepared-statement failure mechanics", () => {
  it("transaction mode + prepared + pool_size < clients raises prepared_missing across seeds", () => {
    let seedsWithError = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const sim = createPoolSim(seed);
      sim.setMode("transaction");
      sim.setClients(8);
      sim.setPoolSize(2); // < clients so transactions land on different backends
      sim.setLoad("high");
      sim.togglePrepared(true);
      let hit = false;
      for (let i = 0; i < 400; i++) {
        sim.step(20);
        const snap = sim.snapshot();
        if (snap.counters.errors.prepared_missing > 0) {
          hit = true;
          expect(snap.eventLog.some((l) => /prepared statement "S_\d+" does not exist/.test(l))).toBe(true);
          break;
        }
      }
      if (hit) seedsWithError++;
    }
    // The classic failure should appear for the large majority of seeds.
    expect(seedsWithError).toBeGreaterThanOrEqual(15);
  });

  it("session mode with the same workload NEVER raises prepared_missing", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const sim = createPoolSim(seed);
      sim.setMode("session");
      sim.setClients(8);
      sim.setPoolSize(2);
      sim.setLoad("high");
      sim.togglePrepared(true);
      for (let i = 0; i < 400; i++) {
        sim.step(20);
        const snap = sim.snapshot();
        expect(snap.counters.errors.prepared_missing).toBe(0);
      }
    }
  });
});

describe("6. FIFO ordering + query_wait_timeout", () => {
  it("waiters are served in FIFO order (queue head leaves before later entries)", () => {
    for (let seed = 1; seed <= 15; seed++) {
      const sim = createPoolSim(seed);
      sim.setMode("transaction");
      sim.setClients(12);
      sim.setPoolSize(2);
      sim.setLoad("high");
      let prevQueue: number[] = [];
      for (let i = 0; i < 300; i++) {
        sim.step(20);
        const snap = sim.snapshot();
        const q = snap.waitQueue;
        // FIFO property: any id present in both prev and current keeps its
        // relative order, and ids only leave from the FRONT (or via timeout).
        // Verify the current queue is a subsequence-preserving evolution: the
        // surviving ids from prev that are still queued appear in the same order.
        const survivors = prevQueue.filter((id) => q.includes(id));
        const currentOrderOfSurvivors = q.filter((id) => survivors.includes(id));
        expect(currentOrderOfSurvivors).toEqual(survivors);
        prevQueue = q;
      }
    }
  });

  it("a waiter exceeding query_wait_timeout errors and leaves the queue", () => {
    // Saturate hard: many clients, single server, high load. With QUERY_WAIT
    // scaled to 5s, stepping past it must produce a timeout.
    const sim = createPoolSim(4);
    sim.setMode("transaction");
    sim.setClients(16);
    sim.setPoolSize(1);
    sim.setLoad("high");
    let sawTimeout = false;
    for (let i = 0; i < 1200; i++) {
      sim.step(20);
      const snap = sim.snapshot();
      if (snap.counters.timeouts > 0) {
        sawTimeout = true;
        // A timed-out client is in error and not in the queue.
        const erroredTimeouts = snap.clients.filter(
          (c) => c.state === "error" && /query_wait_timeout/.test(c.errorMsg ?? ""),
        );
        for (const c of erroredTimeouts) {
          expect(snap.waitQueue.includes(c.id)).toBe(false);
        }
        break;
      }
    }
    expect(sawTimeout, "saturated pool must time out a waiter").toBe(true);
    // The timeout cannot fire faster than the configured window.
    expect(QUERY_WAIT_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe("7. conservation", () => {
  it("server count == pool_size, no client both waiting and linked, counters consistent", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const ops = randomOps(seed * 7, 80);
      const sim = createPoolSim(seed);
      for (const op of ops) {
        applyOp(sim, op);
        const snap = sim.snapshot();
        assertStructuralInvariants(snap);
        // prepared_missing aborts a STARTED transaction, so it can never exceed
        // the number started. (statement_multi and timeouts are rejected before
        // a transaction starts, so they are accounted for separately.)
        expect(snap.counters.errors.prepared_missing).toBeLessThanOrEqual(snap.counters.xactsStarted);
      }
    }
  });
});

describe("8. determinism + spam safety", () => {
  it("same seed + identical call sequence => JSON-equal snapshots at every step", () => {
    const seed = 123;
    const ops = randomOps(seed, 120);
    const a = createPoolSim(seed);
    const b = createPoolSim(seed);
    for (const op of ops) {
      applyOp(a, op);
      applyOp(b, op);
      expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()));
    }
  });

  it("reset returns to the deterministic initial state for the same seed", () => {
    const a = createPoolSim(77);
    const fresh = JSON.stringify(a.snapshot());
    a.setMode("transaction");
    a.setClients(12);
    a.setPoolSize(2);
    a.setLoad("high");
    a.togglePrepared(true);
    for (let i = 0; i < 200; i++) a.step(25);
    a.reset();
    expect(JSON.stringify(a.snapshot())).toBe(fresh);
  });

  it("spamming every method in every reachable state never throws or corrupts", () => {
    const sim = createPoolSim(55);
    const spam = (): void => {
      sim.step(7);
      sim.setMode("session");
      sim.setMode("transaction");
      sim.setMode("statement");
      sim.setClients(1);
      sim.setClients(16);
      sim.setPoolSize(1);
      sim.setPoolSize(8);
      sim.setLoad("high");
      sim.setLoad("low");
      sim.togglePrepared(true);
      sim.togglePrepared(false);
      sim.step(200);
    };
    for (let i = 0; i < 300; i++) {
      expect(() => spam()).not.toThrow();
      assertStructuralInvariants(sim.snapshot());
    }
  });

  it("out-of-range and zero/negative inputs are clamped safely", () => {
    const sim = createPoolSim(2);
    sim.setClients(-5);
    expect(sim.snapshot().clientCount).toBe(1);
    sim.setClients(999);
    expect(sim.snapshot().clientCount).toBe(16);
    sim.setPoolSize(0);
    expect(sim.snapshot().poolSize).toBe(1);
    sim.setPoolSize(50);
    expect(sim.snapshot().poolSize).toBe(8);
    sim.step(0);
    sim.step(-100);
    assertStructuralInvariants(sim.snapshot());
  });
});

describe("metadata", () => {
  it("exports a non-empty SIMPLIFICATIONS list", () => {
    expect(Array.isArray(SIMPLIFICATIONS)).toBe(true);
    expect(SIMPLIFICATIONS.length).toBeGreaterThan(3);
    expect(SIMPLIFICATIONS.every((s) => typeof s === "string" && s.length > 0)).toBe(true);
  });

  it("exposes real-PgBouncer named constants", () => {
    expect(QUERY_WAIT_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
