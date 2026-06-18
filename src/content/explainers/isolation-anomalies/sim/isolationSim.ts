export type IsolationLevel = "RC" | "RR" | "SER";

export const LEVEL_LABELS: Record<IsolationLevel, string> = {
  RC: "Read Committed",
  RR: "Repeatable Read",
  SER: "Serializable",
};

export type TxnId = "T1" | "T2";
export type TxnStatus = "active" | "blocked" | "committed" | "aborted";

// Why a transaction aborted. The two reasons map to the two distinct Postgres
// serialization-failure messages, both SQLSTATE 40001.
export type AbortReason = "concurrent-update" | "read-write-dependency";

export const ABORT_MESSAGE: Record<AbortReason, string> = {
  "concurrent-update": "could not serialize access due to concurrent update",
  "read-write-dependency": "could not serialize access due to read/write dependencies among transactions",
};

export interface RowView {
  id: string;
  label: string;
  committedValue: number;
  // What each transaction's snapshot currently sees for this row (its own
  // uncommitted write wins). null when the transaction can't see the row at all.
  seenBy: Partial<Record<TxnId, number | null>>;
  lockedBy: TxnId | null;
}

export interface OpView {
  text: string;
  detail: string | null; // filled once executed: "= 100", "→ 120", "ABORT 40001 …"
  state: "pending" | "current" | "done" | "blocked" | "failed";
}

export interface TxnView {
  id: TxnId;
  status: TxnStatus;
  cursor: number; // index of the next op to run
  ops: OpView[];
  registers: { name: string; value: number }[];
  snapshotCommitId: number | null; // null until the first statement takes a snapshot
  abortReason: AbortReason | null;
  blockedOn: TxnId | null;
  canStep: boolean;
}

// A rw-antidependency edge X → Y: X read a row that Y then wrote, concurrently.
export interface RwEdge {
  from: TxnId;
  to: TxnId;
  via: string; // row id
}

export interface IsolationSnapshot {
  scenarioId: ScenarioId;
  scenarioTitle: string;
  scenarioQuestion: string;
  level: IsolationLevel;
  rows: RowView[];
  predicateLabel: string | null;
  predicateValues: Partial<Record<TxnId, number>>; // last predicate result per txn
  txns: Record<TxnId, TxnView>;
  edges: RwEdge[];
  finished: boolean;
  anomaly: { kind: AnomalyKind; happened: boolean; text: string } | null;
  autoPlay: boolean;
  scriptDone: boolean;
  eventLog: string[];
}

export type AnomalyKind = "lost-update" | "non-repeatable-read" | "phantom" | "write-skew";
export type ScenarioId = AnomalyKind;

export interface IsolationSim {
  step(dtMs: number): void;
  stepTxn(txn: TxnId): boolean; // advance one op of a transaction; false if it couldn't
  scriptStep(): boolean; // advance the scenario's scripted interleaving by one op
  setAutoPlay(on: boolean): void;
  setLevel(level: IsolationLevel): void;
  setScenario(id: ScenarioId): void;
  reset(): void;
  snapshot(): IsolationSnapshot;
}

export const SIMPLIFICATIONS: readonly string[] = [
  "Two transactions, a handful of rows, integer values. Real workloads interleave many transactions over millions of rows; the dynamics here are the same, the scale is not.",
  "A snapshot is modeled as a single commit counter: a committed version is visible if its commit id is at or below the snapshot's. Real Postgres snapshots are (xmin, xmax, xip[]) triples consulted against commit status in CLOG.",
  "Read Committed refreshes the snapshot once per statement; Repeatable Read and Serializable take one snapshot at the first statement and hold it. That matches Postgres.",
  "Write-write conflicts use first-updater-wins: a writer blocks on an uncommitted writer's row lock, and on wake aborts under RR/SER if that writer committed. Real Postgres does exactly this via tuple locks and the ctid update chain.",
  "SSI is reduced to its core theorem: a cycle in the dependency graph contains a transaction with both an inbound and an outbound rw-antidependency. We abort the transaction whose COMMIT completes that structure. Real SSI (Cahill/Ports) tracks SIREAD locks at page/tuple granularity, may abort a different member of the cycle, and can raise false positives.",
  "Predicate reads (count(*) WHERE …) record only the rows present in the reader's snapshot. Real predicate locks also cover the gaps where a matching row could be inserted, which is how SSI catches a phantom; here phantom-under-Serializable simply resolves to snapshot stability with no dangerous cycle.",
  "Commit is instantaneous and never fails for reasons other than serialization. No deadlock detection, no statement timeouts, no constraint checks beyond the scenario's stated invariant.",
];

interface OpSpec {
  kind: "read" | "predicate" | "write" | "insert" | "commit";
  row?: string;
  into?: string;
  value?: number; // insert value
  compute?: (reg: Record<string, number>, visible: number) => number;
  text: string;
}

interface ScenarioRow {
  id: string;
  label: string;
  value: number;
}

interface Scenario {
  id: ScenarioId;
  title: string;
  question: string;
  rows: ScenarioRow[];
  predicate: { label: string; domain: string[]; match: (v: number) => boolean } | null;
  ops: Record<TxnId, OpSpec[]>;
  script: TxnId[]; // default interleaving that triggers the anomaly
  anomalyKind: AnomalyKind;
  // Given the final committed state, did the anomaly / invariant violation occur?
  detectAnomaly: (finalValues: Record<string, number>, aborted: Set<TxnId>, reads: ReadTrace) => { happened: boolean; text: string };
}

// Per-transaction record of values returned by reads, for anomaly detection in prose-facing text.
type ReadTrace = Record<TxnId, Record<string, number[]>>;

const SCENARIOS: Record<ScenarioId, Scenario> = {
  "lost-update": {
    id: "lost-update",
    title: "Lost update",
    question: "Two transfers read the same balance, each adds to it, both commit. Does the money add up?",
    rows: [{ id: "acct", label: "acct.balance", value: 100 }],
    predicate: null,
    ops: {
      T1: [
        { kind: "read", row: "acct", into: "b", text: "SELECT balance → :b" },
        { kind: "write", row: "acct", compute: (r) => r.b + 10, text: "UPDATE balance := :b + 10" },
        { kind: "commit", text: "COMMIT" },
      ],
      T2: [
        { kind: "read", row: "acct", into: "b", text: "SELECT balance → :b" },
        { kind: "write", row: "acct", compute: (r) => r.b + 20, text: "UPDATE balance := :b + 20" },
        { kind: "commit", text: "COMMIT" },
      ],
    },
    script: ["T1", "T2", "T1", "T2", "T1", "T2"],
    anomalyKind: "lost-update",
    detectAnomaly: (v, aborted) => {
      if (aborted.size > 0) {
        return {
          happened: false,
          text: `balance = ${v.acct} — a transaction got 40001 and must retry; no update silently lost`,
        };
      }
      const ok = v.acct === 130;
      return {
        happened: !ok,
        text: ok
          ? `balance = ${v.acct} — both +10 and +20 applied`
          : `balance = ${v.acct} — an update was silently lost (expected 130)`,
      };
    },
  },

  "non-repeatable-read": {
    id: "non-repeatable-read",
    title: "Non-repeatable read",
    question: "T1 reads a row twice with a concurrent committed write in between. Does it read the same value both times?",
    rows: [{ id: "x", label: "config.x", value: 100 }],
    predicate: null,
    ops: {
      T1: [
        { kind: "read", row: "x", into: "a", text: "SELECT x → :a   (first read)" },
        { kind: "read", row: "x", into: "a2", text: "SELECT x → :a2  (second read)" },
        { kind: "commit", text: "COMMIT" },
      ],
      T2: [
        { kind: "write", row: "x", compute: () => 200, text: "UPDATE x := 200" },
        { kind: "commit", text: "COMMIT" },
      ],
    },
    script: ["T1", "T2", "T2", "T1", "T1"],
    anomalyKind: "non-repeatable-read",
    detectAnomaly: (_v, _a, reads) => {
      const r = reads.T1.x ?? [];
      const repeatable = r.length >= 2 && r[0] === r[1];
      return {
        happened: !repeatable && r.length >= 2,
        text: repeatable
          ? `T1 read ${r[0]} both times — repeatable`
          : `T1 read ${r[0]} then ${r[1]} — the row changed under it`,
      };
    },
  },

  phantom: {
    id: "phantom",
    title: "Phantom read",
    question: "T1 counts matching rows twice while T2 inserts a new match. Does the count stay put?",
    rows: [
      { id: "o1", label: "order o1 (pending)", value: 1 },
      { id: "o2", label: "order o2 (pending)", value: 1 },
    ],
    predicate: { label: "count(*) WHERE status = pending", domain: ["o1", "o2", "o3"], match: (v) => v === 1 },
    ops: {
      T1: [
        { kind: "predicate", into: "c1", text: "SELECT count(*) pending → :c1" },
        { kind: "predicate", into: "c2", text: "SELECT count(*) pending → :c2" },
        { kind: "commit", text: "COMMIT" },
      ],
      T2: [
        { kind: "insert", row: "o3", value: 1, text: "INSERT order o3 (pending)" },
        { kind: "commit", text: "COMMIT" },
      ],
    },
    script: ["T1", "T2", "T2", "T1", "T1"],
    anomalyKind: "phantom",
    detectAnomaly: (_v, _a, reads) => {
      const c = reads.T1.__pred ?? [];
      const stable = c.length >= 2 && c[0] === c[1];
      return {
        happened: !stable && c.length >= 2,
        text: stable
          ? `count stayed ${c[0]} — no phantom`
          : `count went ${c[0]} → ${c[1]} — a phantom row appeared`,
      };
    },
  },

  "write-skew": {
    id: "write-skew",
    title: "Write skew",
    question:
      "Two doctors are on call. Each transaction checks that ≥1 remains, then takes itself off. They touch different rows. Does someone stay on call?",
    rows: [
      { id: "alice", label: "alice.on_call", value: 1 },
      { id: "bob", label: "bob.on_call", value: 1 },
    ],
    predicate: { label: "count(*) WHERE on_call", domain: ["alice", "bob"], match: (v) => v === 1 },
    ops: {
      T1: [
        { kind: "predicate", into: "n", text: "SELECT count(*) on_call → :n" },
        { kind: "write", row: "alice", compute: () => 0, text: "UPDATE alice.on_call := false" },
        { kind: "commit", text: "COMMIT" },
      ],
      T2: [
        { kind: "predicate", into: "n", text: "SELECT count(*) on_call → :n" },
        { kind: "write", row: "bob", compute: () => 0, text: "UPDATE bob.on_call := false" },
        { kind: "commit", text: "COMMIT" },
      ],
    },
    script: ["T1", "T2", "T1", "T2", "T1", "T2"],
    anomalyKind: "write-skew",
    detectAnomaly: (v) => {
      const onCall = (v.alice === 1 ? 1 : 0) + (v.bob === 1 ? 1 : 0);
      return {
        happened: onCall === 0,
        text:
          onCall === 0
            ? "nobody is on call — the invariant both transactions checked is now false"
            : `${onCall} on call — invariant held`,
      };
    },
  },
};

export const SCENARIO_ORDER: ScenarioId[] = ["lost-update", "non-repeatable-read", "phantom", "write-skew"];

interface CommittedVersion {
  value: number;
  commitId: number;
  exists: boolean; // false models a row that does not yet exist (for inserts)
}

interface TxnState {
  id: TxnId;
  cursor: number;
  registers: Record<string, number>;
  snapshotCommitId: number | null;
  status: TxnStatus;
  abortReason: AbortReason | null;
  blockedOn: TxnId | null;
  // Uncommitted writes: rowId -> value. Locks are exactly these rows.
  writes: Map<string, number>;
  readSet: Set<string>; // rows read (point or via predicate), for SSI edges
  concurrent: Set<TxnId>; // txns that were active at some point during this txn's life
  reads: Record<string, number[]>; // trace for anomaly text
  opDetails: (string | null)[];
  opStates: OpView["state"][];
}

export function createIsolationSim(initialScenario: ScenarioId = "lost-update"): IsolationSim {
  let scenarioId: ScenarioId = initialScenario;
  let level: IsolationLevel = "RC";
  let autoPlay = false;

  let scenario: Scenario;
  let committed: Map<string, CommittedVersion[]>; // rowId -> versions, ascending commitId
  let rowOrder: string[]; // display order of rows that exist or may exist
  let lastCommitId: number;
  let txns: Record<TxnId, TxnState>;
  let scriptCursor: number;
  let scriptTimerMs: number;
  let edges: RwEdge[];
  let frozenEdges: RwEdge[] | null; // the dangerous structure captured at the SSI abort
  let eventLog: string[];

  const SCRIPT_INTERVAL_MS = 900;

  function log(line: string): void {
    eventLog.push(line);
    if (eventLog.length > 60) eventLog.shift();
  }

  function newTxn(id: TxnId): TxnState {
    const ops = scenario.ops[id];
    return {
      id,
      cursor: 0,
      registers: {},
      snapshotCommitId: null,
      status: "active",
      abortReason: null,
      blockedOn: null,
      writes: new Map(),
      readSet: new Set(),
      concurrent: new Set(),
      reads: {},
      opDetails: ops.map(() => null),
      opStates: ops.map((_, i) => (i === 0 ? "current" : "pending")),
    };
  }

  function init(): void {
    scenario = SCENARIOS[scenarioId];
    committed = new Map();
    rowOrder = [];
    lastCommitId = 0;
    // Seed initial committed versions at commit id 0. Rows in the predicate
    // domain that aren't seeded start as non-existent (for inserts).
    const seeded = new Set<string>();
    for (const r of scenario.rows) {
      committed.set(r.id, [{ value: r.value, commitId: 0, exists: true }]);
      rowOrder.push(r.id);
      seeded.add(r.id);
    }
    if (scenario.predicate) {
      for (const rid of scenario.predicate.domain) {
        if (!seeded.has(rid)) {
          committed.set(rid, [{ value: 0, commitId: 0, exists: false }]);
          rowOrder.push(rid);
        }
      }
    }
    txns = { T1: newTxn("T1"), T2: newTxn("T2") };
    scriptCursor = 0;
    scriptTimerMs = 0;
    edges = [];
    frozenEdges = null;
    eventLog = [];
  }

  // Effective snapshot commit id for a read by txn t right now.
  function effectiveSnapshot(t: TxnState): number {
    if (level === "RC") return lastCommitId; // fresh per statement
    if (t.snapshotCommitId === null) t.snapshotCommitId = lastCommitId; // taken at first statement
    return t.snapshotCommitId;
  }

  function ensureSnapshotTaken(t: TxnState): void {
    if (level !== "RC" && t.snapshotCommitId === null) t.snapshotCommitId = lastCommitId;
  }

  // Committed version of a row visible at a given snapshot commit id.
  function committedAt(rowId: string, snap: number): CommittedVersion | null {
    const versions = committed.get(rowId);
    if (!versions) return null;
    let best: CommittedVersion | null = null;
    for (const v of versions) {
      if (v.commitId <= snap) best = v;
    }
    return best;
  }

  // Value row r appears to have for txn t (own write wins), or null if it does
  // not exist in t's view.
  function visibleValue(t: TxnState, rowId: string, snap: number): number | null {
    if (t.writes.has(rowId)) return t.writes.get(rowId)!;
    const v = committedAt(rowId, snap);
    if (!v || !v.exists) return null;
    return v.value;
  }

  // Has any transaction committed a change to rowId after t's snapshot?
  function changedSinceSnapshot(t: TxnState, rowId: string): boolean {
    const snap = t.snapshotCommitId ?? lastCommitId;
    const versions = committed.get(rowId);
    if (!versions) return false;
    return versions.some((v) => v.commitId > snap);
  }

  function lockHolder(rowId: string): TxnId | null {
    for (const id of ["T1", "T2"] as TxnId[]) {
      if (txns[id].status !== "committed" && txns[id].status !== "aborted" && txns[id].writes.has(rowId)) return id;
    }
    return null;
  }

  function markConcurrency(): void {
    const live = (["T1", "T2"] as TxnId[]).filter((id) => txns[id].status === "active" || txns[id].status === "blocked");
    for (const a of live) for (const b of live) if (a !== b) txns[a].concurrent.add(b);
  }

  function abort(t: TxnState, reason: AbortReason): void {
    t.status = "aborted";
    t.abortReason = reason;
    t.blockedOn = null;
    t.writes.clear();
    t.opStates[t.cursor] = "failed";
    t.opDetails[t.cursor] = `ABORT 40001 — ${ABORT_MESSAGE[reason]}`;
    log(`${t.id} ABORT (40001): ${ABORT_MESSAGE[reason]}`);
    wakeBlockedOn(t.id);
  }

  function setCurrentMarker(t: TxnState): void {
    if (t.status === "active" && t.cursor < scenario.ops[t.id].length) {
      t.opStates[t.cursor] = "current";
    }
  }

  // The rw-antidependency edges in the current graph, recomputed from scratch.
  function recomputeEdges(): void {
    edges = [];
    const ids: TxnId[] = ["T1", "T2"];
    for (const x of ids) {
      for (const y of ids) {
        if (x === y) continue;
        const tx = txns[x];
        const ty = txns[y];
        if (!tx.concurrent.has(y)) continue;
        // x read a row that y wrote (uncommitted or committed by y).
        for (const rid of tx.readSet) {
          const yWrote = ty.writes.has(rid) || wroteCommitted(y, rid);
          if (yWrote) {
            edges.push({ from: x, to: y, via: rid });
            break;
          }
        }
      }
    }
  }

  const committedWriteRows: Record<TxnId, Set<string>> = { T1: new Set(), T2: new Set() };
  function wroteCommitted(id: TxnId, rid: string): boolean {
    return committedWriteRows[id].has(rid);
  }

  // SSI: is committing txn t the pivot of a dangerous structure
  // (in-edge u→t and an out-edge t→w to a transaction that has already
  // committed)? Requiring the out-neighbour to be committed makes the first
  // committer win and the transaction whose COMMIT closes the cycle the victim,
  // which is what Postgres does in practice.
  function isDangerousPivot(t: TxnState): boolean {
    recomputeEdges();
    const hasIn = edges.some((e) => e.to === t.id);
    const outToCommitted = edges.some((e) => e.from === t.id && txns[e.to].status === "committed");
    return hasIn && outToCommitted;
  }

  function wakeBlockedOn(finished: TxnId): void {
    for (const id of ["T1", "T2"] as TxnId[]) {
      const t = txns[id];
      if (t.status === "blocked" && t.blockedOn === finished) {
        t.status = "active";
        t.blockedOn = null;
        log(`${t.id} woke up (${finished} released its lock)`);
        // Retry the write op it was parked on.
        executeOp(t, true);
      }
    }
  }

  function commit(t: TxnState): void {
    markConcurrency();
    if (level === "SER" && isDangerousPivot(t)) {
      // Freeze the cycle before the abort discards t's writes and collapses it.
      frozenEdges = [...edges];
      abort(t, "read-write-dependency");
      return;
    }
    const cid = ++lastCommitId;
    for (const [rid, val] of t.writes) {
      const versions = committed.get(rid) ?? [];
      versions.push({ value: val, commitId: cid, exists: true });
      committed.set(rid, versions);
      committedWriteRows[t.id].add(rid);
    }
    t.writes.clear();
    t.status = "committed";
    t.opStates[t.cursor] = "done";
    t.opDetails[t.cursor] = `commit id ${cid}`;
    log(`${t.id} COMMIT (commit id ${cid})`);
    wakeBlockedOn(t.id);
    recomputeEdges();
  }

  // Execute the op at t.cursor. `retry` is true when re-running after a wake.
  function executeOp(t: TxnState, retry = false): boolean {
    if (t.status !== "active") return false;
    const ops = scenario.ops[t.id];
    if (t.cursor >= ops.length) return false;
    const op = ops[t.cursor];
    markConcurrency();
    ensureSnapshotTaken(t); // RR/SER fix the snapshot at the first executed statement, whatever its kind

    if (op.kind === "read") {
      const snap = effectiveSnapshot(t);
      const v = visibleValue(t, op.row!, snap) ?? 0;
      t.registers[op.into!] = v;
      t.readSet.add(op.row!);
      (t.reads[op.row!] ??= []).push(v);
      t.opDetails[t.cursor] = `:${op.into} = ${v}`;
      t.opStates[t.cursor] = "done";
      log(`${t.id} read ${op.row} = ${v} (snapshot ≤ ${snap})`);
      advance(t);
      return true;
    }

    if (op.kind === "predicate") {
      ensureSnapshotTaken(t);
      const snap = effectiveSnapshot(t);
      const pred = scenario.predicate!;
      let count = 0;
      for (const rid of pred.domain) {
        const val = visibleValue(t, rid, snap);
        if (val !== null && pred.match(val)) count += 1;
        if (val !== null) t.readSet.add(rid);
      }
      t.registers[op.into!] = count;
      (t.reads.__pred ??= []).push(count);
      t.opDetails[t.cursor] = `:${op.into} = ${count}`;
      t.opStates[t.cursor] = "done";
      log(`${t.id} ${pred.label} = ${count} (snapshot ≤ ${snap})`);
      advance(t);
      return true;
    }

    if (op.kind === "write") {
      const rid = op.row!;
      const holder = lockHolder(rid);
      if (holder && holder !== t.id) {
        t.status = "blocked";
        t.blockedOn = holder;
        t.opStates[t.cursor] = "blocked";
        t.opDetails[t.cursor] = `blocked on ${holder}'s lock`;
        if (!retry) log(`${t.id} write ${rid} BLOCKED on ${holder}'s row lock`);
        return false;
      }
      // First-updater-wins: if a concurrent txn committed a change to this row
      // after our snapshot, RR/SER cannot proceed.
      if (level !== "RC" && changedSinceSnapshot(t, rid)) {
        abort(t, "concurrent-update");
        return false;
      }
      const snap = effectiveSnapshot(t);
      const current = visibleValue(t, rid, snap) ?? 0;
      const val = op.compute!(t.registers, current);
      t.writes.set(rid, val);
      t.opDetails[t.cursor] = `→ ${val} (uncommitted)`;
      t.opStates[t.cursor] = "done";
      log(`${t.id} write ${rid} := ${val} (locks ${rid})`);
      advance(t);
      return true;
    }

    if (op.kind === "insert") {
      const rid = op.row!;
      t.writes.set(rid, op.value!);
      t.opDetails[t.cursor] = `+ ${rid} (uncommitted)`;
      t.opStates[t.cursor] = "done";
      log(`${t.id} insert ${rid}`);
      advance(t);
      return true;
    }

    // commit
    commit(t);
    return true;
  }

  function advance(t: TxnState): void {
    t.cursor += 1;
    setCurrentMarker(t);
    // Auto-run a terminal commit? No — the reader drives commits explicitly.
  }

  function doStepTxn(id: TxnId): boolean {
    const t = txns[id];
    if (t.status !== "active") return false;
    return executeOp(t);
  }

  function doScriptStep(): boolean {
    // Skip past entries whose transaction can't move (already past its ops,
    // committed, aborted, or currently blocked on the other one's turn).
    let guard = 8;
    while (guard-- > 0 && scriptCursor < scenario.script.length) {
      const id = scenario.script[scriptCursor];
      const t = txns[id];
      if (t.status === "active" && t.cursor < scenario.ops[id].length) {
        scriptCursor += 1;
        // A blocked write returns false from executeOp but is still a real
        // scripted event — the script advanced, so report progress and let the
        // next entry (typically the lock holder's COMMIT) wake it.
        executeOp(t);
        return true;
      }
      scriptCursor += 1;
    }
    return false;
  }

  function scriptIsDone(): boolean {
    return scriptCursor >= scenario.script.length && !(["T1", "T2"] as TxnId[]).some((id) => txns[id].status === "blocked");
  }

  function allFinished(): boolean {
    return (["T1", "T2"] as TxnId[]).every((id) => {
      const t = txns[id];
      return t.status === "committed" || t.status === "aborted";
    });
  }

  function buildTxnView(id: TxnId): TxnView {
    const t = txns[id];
    const ops = scenario.ops[id];
    const canStep = t.status === "active" && t.cursor < ops.length;
    return {
      id,
      status: t.status,
      cursor: t.cursor,
      ops: ops.map((op, i) => ({
        text: op.text,
        detail: t.opDetails[i],
        state: t.opStates[i],
      })),
      registers: Object.entries(t.registers).map(([name, value]) => ({ name, value })),
      snapshotCommitId: t.snapshotCommitId,
      abortReason: t.abortReason,
      blockedOn: t.blockedOn,
      canStep,
    };
  }

  function snapshotImpl(): IsolationSnapshot {
    const rows: RowView[] = rowOrder
      .map((rid) => {
        const latest = committed.get(rid)![committed.get(rid)!.length - 1];
        const seenBy: Partial<Record<TxnId, number | null>> = {};
        for (const id of ["T1", "T2"] as TxnId[]) {
          const t = txns[id];
          if (t.snapshotCommitId !== null || level === "RC") {
            const snap = level === "RC" ? lastCommitId : t.snapshotCommitId!;
            seenBy[id] = visibleValue(t, rid, snap);
          }
        }
        const baseLabel = scenario.rows.find((r) => r.id === rid)?.label ?? rid;
        return {
          id: rid,
          label: baseLabel,
          committedValue: latest.exists ? latest.value : NaN,
          seenBy,
          lockedBy: lockHolder(rid),
        };
      })
      .filter((r) => !Number.isNaN(r.committedValue) || lockHolder(r.id) !== null);

    const predicateValues: Partial<Record<TxnId, number>> = {};
    for (const id of ["T1", "T2"] as TxnId[]) {
      const preds = txns[id].reads.__pred;
      if (preds && preds.length) predicateValues[id] = preds[preds.length - 1];
    }

    recomputeEdges();

    let anomaly: IsolationSnapshot["anomaly"] = null;
    if (allFinished()) {
      const finalValues: Record<string, number> = {};
      for (const rid of rowOrder) {
        const latest = committed.get(rid)![committed.get(rid)!.length - 1];
        if (latest.exists) finalValues[rid] = latest.value;
      }
      const aborted = new Set<TxnId>((["T1", "T2"] as TxnId[]).filter((id) => txns[id].status === "aborted"));
      const reads: ReadTrace = { T1: txns.T1.reads, T2: txns.T2.reads };
      const det = scenario.detectAnomaly(finalValues, aborted, reads);
      anomaly = { kind: scenario.anomalyKind, happened: det.happened, text: det.text };
    }

    return {
      scenarioId,
      scenarioTitle: scenario.title,
      scenarioQuestion: scenario.question,
      level,
      rows,
      predicateLabel: scenario.predicate?.label ?? null,
      predicateValues,
      txns: { T1: buildTxnView("T1"), T2: buildTxnView("T2") },
      edges: level === "SER" ? (frozenEdges ?? edges) : [],
      finished: allFinished(),
      anomaly,
      autoPlay,
      scriptDone: scriptIsDone(),
      eventLog: [...eventLog],
    };
  }

  init();

  return {
    step(dtMs: number) {
      if (!autoPlay || dtMs <= 0) return;
      scriptTimerMs += dtMs;
      let guard = 100;
      while (scriptTimerMs >= SCRIPT_INTERVAL_MS && guard-- > 0) {
        scriptTimerMs -= SCRIPT_INTERVAL_MS;
        if (!doScriptStep()) {
          autoPlay = false;
          break;
        }
      }
    },
    stepTxn: doStepTxn,
    scriptStep: doScriptStep,
    setAutoPlay(on: boolean) {
      autoPlay = on;
      if (!on) scriptTimerMs = 0;
    },
    setLevel(l: IsolationLevel) {
      if (l === level) return;
      level = l;
      // Changing the rules resets the run; you can't half-switch an in-flight schedule.
      committedWriteRows.T1.clear();
      committedWriteRows.T2.clear();
      init();
    },
    setScenario(id: ScenarioId) {
      if (id === scenarioId) return;
      scenarioId = id;
      committedWriteRows.T1.clear();
      committedWriteRows.T2.clear();
      init();
    },
    reset() {
      committedWriteRows.T1.clear();
      committedWriteRows.T2.clear();
      init();
    },
    snapshot: snapshotImpl,
  };
}
