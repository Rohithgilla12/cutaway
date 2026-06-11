export type PoolMode = "session" | "transaction" | "statement";

export type LoadLevel = "low" | "high";

export type ClientState = "idle" | "waiting" | "intxn" | "error";

export type ServerState = "idle" | "active" | "reset";

export type ErrorKind = "prepared_missing" | "query_wait_timeout" | "statement_multi";

export interface ServerView {
  id: number;
  state: ServerState;
  linkedClient: number | null;
  preparedSet: string[];
}

export interface ClientView {
  id: number;
  state: ClientState;
  currentServer: number | null;
  preparedWanted: string | null;
  errorMsg: string | null;
}

export interface QueryPulse {
  clientId: number;
  serverId: number;
  progress: number;
}

export interface ErrorCounts {
  prepared_missing: number;
  query_wait_timeout: number;
  statement_multi: number;
}

export interface PoolCounters {
  xactsStarted: number;
  xactsCompleted: number;
  queriesRun: number;
  errors: ErrorCounts;
  timeouts: number;
  avgWaitMs: number;
}

export interface PoolSnapshot {
  mode: PoolMode;
  clientCount: number;
  poolSize: number;
  load: LoadLevel;
  preparedOn: boolean;
  servers: ServerView[];
  clients: ClientView[];
  waitQueue: number[];
  counters: PoolCounters;
  pulses: QueryPulse[];
  eventLog: string[];
}

export interface PoolSim {
  step(dtMs: number): void;
  setMode(mode: PoolMode): void;
  setClients(n: number): void;
  setPoolSize(n: number): void;
  setLoad(level: LoadLevel): void;
  togglePrepared(on: boolean): void;
  reset(): void;
  snapshot(): PoolSnapshot;
}

// query_wait_timeout: real PgBouncer default is 120s. We scale it down to a
// visible window so a saturated pool produces timeouts within a short demo.
export const QUERY_WAIT_TIMEOUT_MS = 5000;

// server_reset_query (DISCARD ALL) busy window after a session-mode release.
export const SERVER_RESET_MS = 120;

export const DEFAULT_CLIENTS = 8;
export const DEFAULT_POOL_SIZE = 3;
export const MIN_CLIENTS = 1;
export const MAX_CLIENTS = 16;
export const MIN_POOL_SIZE = 1;
export const MAX_POOL_SIZE = 8;

const QUERY_MIN_MS = 100;
const QUERY_MAX_MS = 400;
const MAX_QUERIES_PER_XACT = 3;
const EVENT_LOG_MAX = 60;

// Mean idle gap before a client wants its next transaction. High load fires
// clients far more often than pool_size can absorb, which is what drives the
// wait queue and timeouts.
const IDLE_MEAN_LOW_MS = 1400;
const IDLE_MEAN_HIGH_MS = 260;

// In session mode, a linked client occasionally disconnects between
// transactions so the freed server becomes visibly reusable by another client.
const SESSION_DISCONNECT_CHANCE = 0.22;

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

function clampInt(n: number, lo: number, hi: number): number {
  const i = Math.floor(n);
  if (i < lo) return lo;
  if (i > hi) return hi;
  return i;
}

interface PlannedQuery {
  durationMs: number;
  // The protocol-level prepared statement this query EXECUTEs, if any. A
  // transaction that uses prepared statements issues a PREPARE on its first
  // query, then EXECUTEs the same name on later queries.
  prepares: string | null; // PREPARE S_n issued by this query
  executes: string | null; // EXECUTE S_n issued by this query
}

interface PlannedXact {
  queries: PlannedQuery[];
}

interface InternalServer {
  id: number;
  state: ServerState;
  linkedClient: number | null;
  preparedSet: Set<string>;
  // remaining server_reset_query (DISCARD ALL) busy time after a session release
  resetRemainingMs: number;
}

interface InternalClient {
  id: number;
  state: ClientState;
  server: number | null; // server this client currently holds (session link or active xact)
  errorKind: ErrorKind | null;
  errorMsg: string | null;
  // countdown to next transaction when idle
  idleRemainingMs: number;
  // in-flight transaction
  xact: PlannedXact | null;
  queryIndex: number; // index of the query currently running / next to run
  queryRemainingMs: number; // remaining duration of the running query
  running: boolean; // a query is actively executing on a server right now
  // wait-queue bookkeeping
  enqueuedAtMs: number;
  // The long-lived protocol-level prepared statement this client uses (PREPARE
  // issued once, then EXECUTEd by every later transaction), or null if it has
  // not prepared one yet. This survives across transactions, which is exactly
  // why transaction-mode reuse on a different backend fails.
  preparedName: string | null;
  // back-off after an error before the client tries again
  errorRemainingMs: number;
}

const ERROR_BACKOFF_MS = 800;

export function createPoolSim(seed: number): PoolSim {
  const rng = mulberry32(seed);

  let mode: PoolMode;
  let clientCount: number;
  let poolSize: number;
  let load: LoadLevel;
  let preparedOn: boolean;
  let nowMs: number;

  let servers: InternalServer[];
  let clients: InternalClient[];
  let waitQueue: number[]; // FIFO of client ids waiting for a server

  let xactsStarted: number;
  let xactsCompleted: number;
  let queriesRun: number;
  let errPrepared: number;
  let errTimeout: number;
  let errStatementMulti: number;
  let totalWaitMs: number;
  let waitSamples: number;

  let eventLog: string[];

  function init(): void {
    mode = "session";
    clientCount = DEFAULT_CLIENTS;
    poolSize = DEFAULT_POOL_SIZE;
    load = "low";
    preparedOn = false;
    nowMs = 0;
    xactsStarted = 0;
    xactsCompleted = 0;
    queriesRun = 0;
    errPrepared = 0;
    errTimeout = 0;
    errStatementMulti = 0;
    totalWaitMs = 0;
    waitSamples = 0;
    eventLog = [];
    buildServers();
    buildClients();
  }

  function buildServers(): void {
    servers = [];
    for (let i = 0; i < poolSize; i++) {
      servers.push({
        id: i,
        state: "idle",
        linkedClient: null,
        preparedSet: new Set<string>(),
        resetRemainingMs: 0,
      });
    }
  }

  function buildClients(): void {
    clients = [];
    waitQueue = [];
    for (let i = 0; i < clientCount; i++) {
      clients.push(freshClient(i));
    }
  }

  function freshClient(id: number): InternalClient {
    return {
      id,
      state: "idle",
      server: null,
      errorKind: null,
      errorMsg: null,
      idleRemainingMs: nextIdleGap(),
      xact: null,
      queryIndex: 0,
      queryRemainingMs: 0,
      running: false,
      enqueuedAtMs: 0,
      preparedName: null,
      errorRemainingMs: 0,
    };
  }

  function nextIdleGap(): number {
    const mean = load === "high" ? IDLE_MEAN_HIGH_MS : IDLE_MEAN_LOW_MS;
    // exponential-ish gap so arrivals are bursty; bounded away from zero.
    const u = 1 - rng();
    return Math.max(20, Math.floor(-mean * Math.log(u)));
  }

  function log(line: string): void {
    eventLog.push(line);
    if (eventLog.length > EVENT_LOG_MAX) {
      eventLog.splice(0, eventLog.length - EVENT_LOG_MAX);
    }
  }

  function planXact(client: InternalClient): PlannedXact {
    const queryCount = 1 + Math.floor(rng() * MAX_QUERIES_PER_XACT);
    const queries: PlannedQuery[] = [];
    // Decide whether this transaction uses the client's protocol-level prepared
    // statement. The PREPARE is issued ONCE (the first time the client ever uses
    // a prepared statement) and lives on whatever backend held the client then.
    // Every later transaction only EXECUTEs that long-lived name — which is what
    // breaks in transaction mode when a later xact lands on a different backend.
    const usesPrepared = preparedOn && rng() < 0.7;
    let name: string | null = null;
    let prepareHere = false;
    if (usesPrepared) {
      name = "S_1";
      // A client only believes it has already prepared the statement once a
      // PREPARE has actually reached a backend (preparedName set in
      // startNextQuery). Until then — including a transaction that timed out in
      // the wait queue before ever running — it must PREPARE first. Setting the
      // belief at plan time would let a never-run transaction skip the PREPARE
      // and then EXECUTE on a fresh backend, a false failure.
      prepareHere = client.preparedName === null;
    }
    for (let q = 0; q < queryCount; q++) {
      const durationMs = QUERY_MIN_MS + Math.floor(rng() * (QUERY_MAX_MS - QUERY_MIN_MS + 1));
      queries.push({
        durationMs,
        prepares: prepareHere && q === 0 ? name : null,
        executes: name,
      });
    }
    return { queries };
  }

  // A prepared statement is identified by (owning client, statement name) within
  // a backend session — same name from a different client is a different object.
  function prepKey(clientId: number, name: string): string {
    return `c${clientId}:${name}`;
  }

  function findIdleServer(): InternalServer | null {
    for (const s of servers) {
      if (s.state === "idle" && s.linkedClient === null && s.resetRemainingMs === 0) {
        return s;
      }
    }
    return null;
  }

  // A client needs a server. If it already holds one — a session-mode sticky
  // link, possibly established before a mode change — it reuses that exact server
  // without touching the queue. This is how an existing link drains under the old
  // mode's rules after the operator switches pool_mode. Otherwise it grabs an
  // idle server, or joins the FIFO wait queue.
  function requestServer(client: InternalClient): InternalServer | null {
    if (client.server !== null) {
      const held = servers[client.server];
      if (held && held.linkedClient === client.id) return held;
      // Stale pointer (server removed): fall through to a fresh acquisition.
      client.server = null;
    }
    const s = findIdleServer();
    if (s) {
      linkServer(s, client);
      return s;
    }
    return null;
  }

  function linkServer(server: InternalServer, client: InternalClient): void {
    server.state = "active";
    server.linkedClient = client.id;
    client.server = server.id;
  }

  function enqueue(client: InternalClient): void {
    if (!waitQueue.includes(client.id)) {
      client.state = "waiting";
      client.enqueuedAtMs = nowMs;
      waitQueue.push(client.id);
    }
  }

  // Try to hand idle servers to the head of the FIFO queue. Each waiter that
  // gets a server starts its transaction immediately.
  function pumpWaitQueue(): void {
    let progressed = true;
    while (progressed && waitQueue.length > 0) {
      progressed = false;
      const free = findIdleServer();
      if (!free) break;
      const clientId = waitQueue[0];
      const client = clients[clientId];
      if (!client) {
        waitQueue.shift();
        progressed = true;
        continue;
      }
      waitQueue.shift();
      const waited = nowMs - client.enqueuedAtMs;
      totalWaitMs += waited;
      waitSamples += 1;
      linkServer(free, client);
      beginTransactionOn(client, free);
      progressed = true;
    }
  }

  function beginTransactionOn(client: InternalClient, server: InternalServer): void {
    // statement mode disallows multi-statement transactions: PgBouncer cannot
    // keep a server pinned across statements, so a transaction touching more
    // than one statement breaks. We surface that as a client error.
    if (client.xact === null) {
      client.xact = planXact(client);
      client.queryIndex = 0;
    }
    if (mode === "statement" && client.xact.queries.length > 1) {
      failClient(client, "statement_multi", "transaction blocks not allowed in statement pooling mode");
      client.xact = null;
      releaseServer(server, /*runReset*/ false, client);
      return;
    }
    client.state = "intxn";
    xactsStarted += 1;
    startNextQuery(client, server);
  }

  function startNextQuery(client: InternalClient, server: InternalServer): void {
    const xact = client.xact;
    if (!xact) return;
    const query = xact.queries[client.queryIndex];
    // PREPARE lands on whatever server the client currently holds. Only now does
    // the client start believing the statement exists (so a later transaction
    // sends EXECUTE without re-PREPARE). A protocol-level prepared statement
    // lives in the SERVER's session and belongs to the client that prepared it,
    // so we key the server's set by client — another client's S_1 on the same
    // backend does not satisfy this client's EXECUTE.
    if (query.prepares) {
      server.preparedSet.add(prepKey(client.id, query.prepares));
      client.preparedName = query.prepares;
    }
    // EXECUTE of a named statement succeeds only if THIS client prepared it on
    // THIS server. In transaction mode a later transaction can be routed to a
    // backend the client never prepared on -> "does not exist".
    if (query.executes && !server.preparedSet.has(prepKey(client.id, query.executes))) {
      failClient(client, "prepared_missing", `prepared statement "${query.executes}" does not exist`);
      // The failed statement aborts the transaction; release per current mode.
      finishTransaction(client, server, /*completed*/ false);
      return;
    }
    client.queryRemainingMs = query.durationMs;
    client.running = true;
    client.state = "intxn";
    server.state = "active";
  }

  function failClient(client: InternalClient, kind: ErrorKind, msg: string): void {
    client.state = "error";
    client.errorKind = kind;
    client.errorMsg = msg;
    client.errorRemainingMs = ERROR_BACKOFF_MS;
    client.running = false;
    if (kind === "prepared_missing") errPrepared += 1;
    else if (kind === "query_wait_timeout") {
      errTimeout += 1;
    } else if (kind === "statement_multi") errStatementMulti += 1;
    log(`client ${client.id}: ${msg}`);
  }

  // Release a server back to the pool, unlinking BOTH sides so no caller can
  // leave a client pointing at a server it no longer holds. In session mode a
  // release runs server_reset_query (DISCARD ALL) — modeled as a brief busy
  // "reset" window — and the prepared set is wiped. Transaction/statement
  // releases in real PgBouncer skip the reset by default (see SIMPLIFICATIONS).
  function releaseServer(server: InternalServer, runReset: boolean, client?: InternalClient): void {
    if (client && client.server === server.id) client.server = null;
    server.linkedClient = null;
    if (runReset) {
      server.preparedSet.clear();
      server.state = "reset";
      server.resetRemainingMs = SERVER_RESET_MS;
    } else {
      server.state = "idle";
    }
  }

  // End the current transaction. completed=true means COMMIT; false means it
  // aborted (ROLLBACK) due to an error. Release timing is the heart of the model.
  function finishTransaction(client: InternalClient, server: InternalServer, completed: boolean): void {
    if (completed) {
      xactsCompleted += 1;
    }
    client.xact = null;
    client.queryIndex = 0;
    client.running = false;
    client.queryRemainingMs = 0;

    if (mode === "session") {
      // Server stays linked to the client across transactions. Occasionally the
      // client disconnects, which is the only thing that frees the server here.
      const disconnect = rng() < SESSION_DISCONNECT_CHANCE;
      if (disconnect) {
        // A session-mode disconnect tears down the client connection: its
        // protocol-level prepared statements are gone, so it will re-PREPARE on
        // its next backend rather than EXECUTE a name the new server never saw.
        client.preparedName = null;
        releaseServer(server, /*runReset*/ true, client);
        log(`client ${client.id}: disconnect (session) — server ${server.id} reset`);
      }
      if (client.state !== "error") {
        client.state = "idle";
        client.idleRemainingMs = nextIdleGap();
      }
    } else {
      // transaction & statement modes: server released at COMMIT/ROLLBACK
      // (statement mode also releases between statements, handled separately).
      releaseServer(server, /*runReset*/ false, client);
      if (client.state !== "error") {
        client.state = "idle";
        client.idleRemainingMs = nextIdleGap();
      }
    }
  }

  function onQueryComplete(client: InternalClient, server: InternalServer): void {
    queriesRun += 1;
    client.running = false;
    const xact = client.xact;
    if (!xact) {
      finishTransaction(client, server, true);
      return;
    }
    const wasLast = client.queryIndex >= xact.queries.length - 1;

    if (mode === "statement") {
      // Statement mode releases the server after EVERY statement. A single-
      // statement transaction is the only legal shape here, so completing it
      // ends the transaction and frees the server.
      finishTransaction(client, server, true);
      return;
    }

    if (wasLast) {
      finishTransaction(client, server, true);
      return;
    }

    // More queries in this transaction. In session and transaction modes the
    // SAME server stays pinned for the whole transaction.
    client.queryIndex += 1;
    startNextQuery(client, server);
  }

  function advanceClient(client: InternalClient, dtMs: number): void {
    if (client.state === "error") {
      client.errorRemainingMs -= dtMs;
      if (client.errorRemainingMs <= 0) {
        client.errorKind = null;
        client.errorMsg = null;
        client.state = "idle";
        client.idleRemainingMs = nextIdleGap();
      }
      return;
    }

    if (client.state === "waiting") {
      // Timeout check: a waiter that exceeds query_wait_timeout errors out and
      // leaves the queue.
      if (nowMs - client.enqueuedAtMs >= QUERY_WAIT_TIMEOUT_MS) {
        removeFromQueue(client.id);
        client.xact = null;
        failClient(client, "query_wait_timeout", "query_wait_timeout: no server connection available");
      }
      return;
    }

    if (client.state === "intxn") {
      if (client.server === null) return;
      const server = servers[client.server];
      if (!server) return;
      if (client.running) {
        client.queryRemainingMs -= dtMs;
        if (client.queryRemainingMs <= 0) {
          onQueryComplete(client, server);
        }
      }
      return;
    }

    // idle
    client.idleRemainingMs -= dtMs;
    if (client.idleRemainingMs <= 0) {
      wantTransaction(client);
    }
  }

  function wantTransaction(client: InternalClient): void {
    // The client wants to run a transaction. Acquire a server per current mode.
    const server = requestServer(client);
    if (server) {
      beginTransactionOn(client, server);
    } else {
      // No idle server: plan the transaction now (so it survives the wait) and
      // join the FIFO queue.
      if (client.xact === null) {
        client.xact = planXact(client);
        client.queryIndex = 0;
      }
      enqueue(client);
    }
  }

  function removeFromQueue(clientId: number): void {
    const idx = waitQueue.indexOf(clientId);
    if (idx >= 0) waitQueue.splice(idx, 1);
  }

  function advanceServers(dtMs: number): void {
    for (const s of servers) {
      if (s.state === "reset") {
        s.resetRemainingMs -= dtMs;
        if (s.resetRemainingMs <= 0) {
          s.resetRemainingMs = 0;
          s.state = "idle";
        }
      }
    }
  }

  function doStep(dtMs: number): void {
    if (dtMs <= 0) return;
    nowMs += dtMs;
    advanceServers(dtMs);
    // Advance clients on a stable snapshot of ids so reassignment mid-loop
    // (a freed server handed to a waiter) doesn't double-advance anyone.
    for (const client of clients) {
      advanceClient(client, dtMs);
    }
    // Hand any servers freed this tick to FIFO waiters.
    pumpWaitQueue();
  }

  function doSetMode(next: PoolMode): void {
    // Existing links drain under the OLD mode's release rules (transactions in
    // flight keep their server until they end the old way); new assignments use
    // the new mode. See SIMPLIFICATIONS — real PgBouncer requires the pool to
    // drain on a mode change rather than switching live.
    if (next === mode) return;
    log(`pool mode -> ${next}`);
    mode = next;
  }

  function doSetClients(n: number): void {
    const next = clampInt(n, MIN_CLIENTS, MAX_CLIENTS);
    if (next === clientCount) return;
    if (next > clientCount) {
      for (let i = clientCount; i < next; i++) {
        clients.push(freshClient(i));
      }
    } else {
      // Removing clients: release any servers they hold and drop them from the
      // queue so conservation invariants hold.
      for (let i = next; i < clientCount; i++) {
        const c = clients[i];
        if (c.server !== null) {
          const s = servers[c.server];
          if (s && s.linkedClient === c.id) releaseServer(s, false);
        }
        removeFromQueue(c.id);
      }
      clients = clients.slice(0, next);
    }
    clientCount = next;
  }

  function doSetPoolSize(n: number): void {
    const next = clampInt(n, MIN_POOL_SIZE, MAX_POOL_SIZE);
    if (next === poolSize) return;
    if (next > poolSize) {
      for (let i = poolSize; i < next; i++) {
        servers.push({
          id: i,
          state: "idle",
          linkedClient: null,
          preparedSet: new Set<string>(),
          resetRemainingMs: 0,
        });
      }
    } else {
      // Shrinking the pool: any client linked to a removed server is bumped back
      // to idle (its in-flight work is dropped). This keeps server count ==
      // pool_size and prevents a stale link to a sliced-off server index.
      servers = servers.slice(0, next);
      for (const c of clients) {
        if (c.server !== null && c.server >= next) {
          c.server = null;
          c.running = false;
          c.xact = null;
          c.queryIndex = 0;
          c.queryRemainingMs = 0;
          if (c.state === "intxn") {
            c.state = "idle";
            c.idleRemainingMs = nextIdleGap();
          }
        }
      }
    }
    poolSize = next;
  }

  function doSetLoad(level: LoadLevel): void {
    load = level;
  }

  function doTogglePrepared(on: boolean): void {
    preparedOn = on;
  }

  function snapshotImpl(): PoolSnapshot {
    const serverViews: ServerView[] = servers.map((s) => ({
      id: s.id,
      state: s.state,
      linkedClient: s.linkedClient,
      preparedSet: [...s.preparedSet].sort(),
    }));

    const clientViews: ClientView[] = clients.map((c) => ({
      id: c.id,
      state: c.state,
      currentServer: c.server,
      preparedWanted: currentPrepared(c),
      errorMsg: c.errorMsg,
    }));

    const pulses: QueryPulse[] = [];
    for (const c of clients) {
      if (c.state === "intxn" && c.running && c.server !== null && c.xact) {
        const dur = c.xact.queries[c.queryIndex]?.durationMs ?? 1;
        const progress = dur > 0 ? 1 - c.queryRemainingMs / dur : 1;
        pulses.push({
          clientId: c.id,
          serverId: c.server,
          progress: Math.min(1, Math.max(0, progress)),
        });
      }
    }

    const avgWaitMs = waitSamples > 0 ? Math.round(totalWaitMs / waitSamples) : 0;

    return {
      mode,
      clientCount,
      poolSize,
      load,
      preparedOn,
      servers: serverViews,
      clients: clientViews,
      waitQueue: [...waitQueue],
      counters: {
        xactsStarted,
        xactsCompleted,
        queriesRun,
        errors: {
          prepared_missing: errPrepared,
          query_wait_timeout: errTimeout,
          statement_multi: errStatementMulti,
        },
        timeouts: errTimeout,
        avgWaitMs,
      },
      pulses,
      eventLog: [...eventLog],
    };
  }

  function currentPrepared(c: InternalClient): string | null {
    if (!c.xact) return null;
    const q = c.xact.queries[c.queryIndex];
    if (!q) return null;
    return q.executes ?? q.prepares ?? null;
  }

  init();

  return {
    step: doStep,
    setMode: doSetMode,
    setClients: doSetClients,
    setPoolSize: doSetPoolSize,
    setLoad: doSetLoad,
    togglePrepared: doTogglePrepared,
    reset: init,
    snapshot: snapshotImpl,
  };
}

export const SIMPLIFICATIONS: readonly string[] = [
  "One database, one user, one pool. Real PgBouncer keeps a separate server pool per (database, user) pair.",
  "query_wait_timeout is scaled to 5s (real default 120s) so a saturated pool produces timeouts inside a short demo.",
  "Prepared statements model the CLASSIC failure: a protocol-level PREPARE lives only on the server that ran it, so transaction-mode reuse on a different backend raises 'prepared statement \"S_n\" does not exist'. PgBouncer >= 1.21 can track and replay prepared statements via max_prepared_statements, which removes this failure; we do not model that path.",
  "server_reset_query (DISCARD ALL) is modeled as a brief busy window on session-mode release only. Real PgBouncer skips the reset query in transaction mode by default (server_reset_query_always = 0).",
  "A mode change takes effect for new assignments immediately while in-flight links drain under the old mode's rules. Real PgBouncer applies pool_mode changes per pool and expects the pool to drain across a RELOAD rather than switching mid-transaction.",
  "Query durations are a uniform 100-400 sim-ms with no tail latency; real query time is heavy-tailed.",
  "Client arrivals are an exponential idle gap per client; there is no connection-establishment cost or TCP backlog.",
  "A statement error or prepared-statement error aborts the whole transaction (ROLLBACK) immediately; we do not model partial statement retries.",
  "Shrinking pool_size or client count drops in-flight work for the removed connections rather than draining it gracefully.",
  "No transaction-vs-idle-in-transaction distinction: a client is either running a statement or between statements; we don't model an open idle transaction holding a server in transaction mode (which it would in reality).",
];
