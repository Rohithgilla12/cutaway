export type Role = "follower" | "candidate" | "leader" | "dead";

export interface LogEntry {
  term: number;
  value: number;
}

export type MessageKind = "RequestVote" | "RequestVoteReply" | "AppendEntries" | "AppendEntriesReply";

export interface MessageView {
  id: number;
  from: number;
  to: number;
  kind: MessageKind;
  term: number;
  progress: number;
}

export interface NodeView {
  id: number;
  role: Role;
  alive: boolean;
  currentTerm: number;
  votedFor: number | null;
  log: LogEntry[];
  commitIndex: number;
  timerPct: number;
  votesGranted: number[];
  committedValues: number[];
}

export interface LinkView {
  a: number;
  b: number;
  up: boolean;
}

export interface RaftSnapshot {
  now: number;
  nodes: NodeView[];
  links: LinkView[];
  messages: MessageView[];
  eventLog: string[];
  electionCount: number;
}

export const NODE_COUNT = 5;
export const QUORUM = 3;
export const HEARTBEAT_INTERVAL_MS = 500;
export const ELECTION_TIMEOUT_MIN_MS = 1500;
export const ELECTION_TIMEOUT_MAX_MS = 3000;
export const LATENCY_MIN_MS = 80;
export const LATENCY_MAX_MS = 150;
export const EVENT_LOG_LIMIT = 60;

export const SIMPLIFICATIONS: readonly string[] = [
  "No log snapshotting or compaction: the log grows unbounded and recovery always starts from index 0.",
  "No cluster membership changes (no joint consensus); the 5-node set is fixed.",
  "clientWrite appends a single auto-incrementing value; there is no client request id, dedup, or read path.",
  "No persistent-storage write latency: persisted term/votedFor/log update synchronously before a reply is sent.",
  "Latency is a single seeded jitter per message in flight; there is no per-link bandwidth, queueing, or reordering model beyond independent delays.",
  "Election timeouts and the heartbeat interval are scaled to human-watchable seconds, not the 150-300ms of a real deployment.",
  "AppendEntries carries the entire suffix after prevLogIndex rather than batching/limiting entries per RPC.",
  "Followers never fast-forward conflict resolution (no conflictTerm/conflictIndex optimization); the leader backs off one index per round.",
  "A dead node freezes all timers and drops all traffic; there is no slow node, GC pause, or asymmetric link failure (links are symmetric up/down).",
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

interface RVPayload {
  candidateId: number;
  lastLogIndex: number;
  lastLogTerm: number;
}

interface RVReplyPayload {
  voteGranted: boolean;
}

interface AEPayload {
  leaderId: number;
  prevLogIndex: number;
  prevLogTerm: number;
  entries: LogEntry[];
  leaderCommit: number;
}

interface AEReplyPayload {
  success: boolean;
  // matchIndex the follower reached on success, so the leader advances precisely.
  matchIndex: number;
}

type Payload = RVPayload | RVReplyPayload | AEPayload | AEReplyPayload;

interface Message {
  id: number;
  from: number;
  to: number;
  kind: MessageKind;
  term: number;
  payload: Payload;
  totalMs: number;
  elapsedMs: number;
}

interface Node {
  id: number;
  // Persistent state (survives crash/restart per Raft §5; reset only on full sim reset).
  currentTerm: number;
  votedFor: number | null;
  log: LogEntry[];
  // Volatile state (reset on restart).
  role: Role;
  commitIndex: number;
  // Leader volatile state, indexed by peer id.
  nextIndex: number[];
  matchIndex: number[];
  // Election bookkeeping.
  votesGranted: Set<number>;
  electionTimeoutMs: number;
  electionElapsedMs: number;
  heartbeatElapsedMs: number;
  alive: boolean;
}

export interface RaftSim {
  step(dtMs: number): void;
  killNode(i: number): void;
  restartNode(i: number): void;
  cutLink(a: number, b: number): void;
  healLink(a: number, b: number): void;
  partition(groups: number[][]): void;
  healAll(): void;
  clientWrite(): void;
  reset(): void;
  snapshot(): RaftSnapshot;
}

function linkKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function createRaftSim(seed: number): RaftSim {
  const rng = mulberry32(seed);

  let now: number;
  let nodes: Node[];
  let messages: Message[];
  let downLinks: Set<string>;
  let eventLog: string[];
  let electionCount: number;
  let nextMsgId: number;
  let nextWriteValue: number;

  function randTimeout(): number {
    return ELECTION_TIMEOUT_MIN_MS + Math.floor(rng() * (ELECTION_TIMEOUT_MAX_MS - ELECTION_TIMEOUT_MIN_MS + 1));
  }

  function randLatency(): number {
    return LATENCY_MIN_MS + Math.floor(rng() * (LATENCY_MAX_MS - LATENCY_MIN_MS + 1));
  }

  function log(line: string): void {
    eventLog.push(line);
    if (eventLog.length > EVENT_LOG_LIMIT) {
      eventLog.splice(0, eventLog.length - EVENT_LOG_LIMIT);
    }
  }

  function init(): void {
    now = 0;
    messages = [];
    downLinks = new Set();
    eventLog = [];
    electionCount = 0;
    nextMsgId = 1;
    nextWriteValue = 1;
    nodes = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      nodes.push({
        id: i,
        currentTerm: 0,
        votedFor: null,
        log: [],
        role: "follower",
        commitIndex: 0,
        nextIndex: new Array(NODE_COUNT).fill(1),
        matchIndex: new Array(NODE_COUNT).fill(0),
        votesGranted: new Set(),
        electionTimeoutMs: randTimeout(),
        electionElapsedMs: 0,
        heartbeatElapsedMs: 0,
        alive: true,
      });
    }
  }

  function lastLogIndex(n: Node): number {
    return n.log.length;
  }

  function lastLogTerm(n: Node): number {
    return n.log.length === 0 ? 0 : n.log[n.log.length - 1].term;
  }

  function termAt(n: Node, index: number): number {
    // 1-based log index; index 0 is the empty sentinel with term 0.
    if (index <= 0) return 0;
    if (index > n.log.length) return 0;
    return n.log[index - 1].term;
  }

  function linkUp(a: number, b: number): boolean {
    return !downLinks.has(linkKey(a, b));
  }

  function send(from: number, to: number, kind: MessageKind, term: number, payload: Payload): void {
    // A message is created even if the link is currently down; it is dropped on
    // delivery (or mid-flight if the link is cut later). The sender does not
    // observe link state. But a dead sender produces nothing.
    if (!nodes[from].alive) return;
    messages.push({
      id: nextMsgId++,
      from,
      to,
      kind,
      term,
      payload,
      totalMs: randLatency(),
      elapsedMs: 0,
    });
  }

  function stepDown(n: Node, term: number, reason: string): void {
    // Any higher-term message converts a node to a follower in that term (§5.1).
    const wasLeaderOrCandidate = n.role === "leader" || n.role === "candidate";
    if (term > n.currentTerm) {
      n.currentTerm = term;
      n.votedFor = null;
    }
    if (n.role !== "follower") {
      if (wasLeaderOrCandidate) {
        log(`n${n.id} sees term ${term}, steps down (${reason})`);
      }
      n.role = "follower";
      n.votesGranted.clear();
    }
    // Reset the election timer on observing a higher term so the new leader can
    // settle without an immediate competing election.
    n.electionElapsedMs = 0;
  }

  function becomeCandidate(n: Node): void {
    n.currentTerm += 1;
    n.role = "candidate";
    n.votedFor = n.id;
    n.votesGranted = new Set([n.id]);
    n.electionTimeoutMs = randTimeout();
    n.electionElapsedMs = 0;
    electionCount += 1;
    log(`n${n.id} times out, starts election for term ${n.currentTerm}`);
    for (let peer = 0; peer < NODE_COUNT; peer++) {
      if (peer === n.id) continue;
      send(n.id, peer, "RequestVote", n.currentTerm, {
        candidateId: n.id,
        lastLogIndex: lastLogIndex(n),
        lastLogTerm: lastLogTerm(n),
      });
    }
    maybeWinElection(n);
  }

  function maybeWinElection(n: Node): void {
    if (n.role !== "candidate") return;
    if (n.votesGranted.size >= QUORUM) {
      becomeLeader(n);
    }
  }

  function becomeLeader(n: Node): void {
    n.role = "leader";
    for (let peer = 0; peer < NODE_COUNT; peer++) {
      n.nextIndex[peer] = lastLogIndex(n) + 1;
      n.matchIndex[peer] = 0;
    }
    n.matchIndex[n.id] = lastLogIndex(n);
    n.heartbeatElapsedMs = HEARTBEAT_INTERVAL_MS; // send heartbeats immediately
    log(`n${n.id} elected — ${n.votesGranted.size}/${NODE_COUNT} votes (term ${n.currentTerm})`);
  }

  function candidateLogUpToDate(voter: Node, lastIdx: number, lastTerm: number): boolean {
    // §5.4.1: candidate's log is at least as up-to-date as the voter's if its
    // last entry has a higher term, or the same term and an index >= the voter's.
    const voterLastTerm = lastLogTerm(voter);
    const voterLastIdx = lastLogIndex(voter);
    if (lastTerm !== voterLastTerm) return lastTerm > voterLastTerm;
    return lastIdx >= voterLastIdx;
  }

  function handleRequestVote(n: Node, msg: Message): void {
    const p = msg.payload as RVPayload;
    if (msg.term > n.currentTerm) {
      stepDown(n, msg.term, `RequestVote from n${p.candidateId}`);
    }
    let granted = false;
    if (msg.term < n.currentTerm) {
      granted = false;
    } else if (
      (n.votedFor === null || n.votedFor === p.candidateId) &&
      candidateLogUpToDate(n, p.lastLogIndex, p.lastLogTerm)
    ) {
      granted = true;
      n.votedFor = p.candidateId;
      // Granting a vote is itself an act of recognizing the term; reset our timer
      // so we do not immediately launch a competing candidacy.
      n.electionElapsedMs = 0;
      log(`n${n.id} grants vote to n${p.candidateId} (term ${n.currentTerm})`);
    }
    send(n.id, msg.from, "RequestVoteReply", n.currentTerm, {
      voteGranted: granted,
    });
  }

  function handleRequestVoteReply(n: Node, msg: Message): void {
    const p = msg.payload as RVReplyPayload;
    if (msg.term > n.currentTerm) {
      stepDown(n, msg.term, `RequestVoteReply from n${msg.from}`);
      return;
    }
    if (n.role !== "candidate" || msg.term !== n.currentTerm) return;
    if (p.voteGranted) {
      n.votesGranted.add(msg.from);
      maybeWinElection(n);
    }
  }

  function handleAppendEntries(n: Node, msg: Message): void {
    const p = msg.payload as AEPayload;
    if (msg.term > n.currentTerm) {
      stepDown(n, msg.term, `AppendEntries from n${p.leaderId}`);
    }
    if (msg.term < n.currentTerm) {
      // Stale leader: reject and let our higher term inform it (§5.1).
      send(n.id, msg.from, "AppendEntriesReply", n.currentTerm, {
        success: false,
        matchIndex: 0,
      });
      return;
    }
    // Valid current-term leader exists: recognize it and reset our timer.
    if (n.role === "candidate") {
      n.role = "follower";
      n.votesGranted.clear();
    }
    n.role = "follower";
    n.electionElapsedMs = 0;

    // Consistency check (§5.3): our log must contain prevLogIndex with prevLogTerm.
    const consistent =
      p.prevLogIndex === 0 || (p.prevLogIndex <= n.log.length && termAt(n, p.prevLogIndex) === p.prevLogTerm);

    if (!consistent) {
      send(n.id, msg.from, "AppendEntriesReply", n.currentTerm, {
        success: false,
        matchIndex: 0,
      });
      return;
    }

    // Append/overwrite: find the first conflicting entry and truncate, then append
    // the remaining new entries (§5.3). Existing matching entries are left alone so
    // we never truncate committed entries we already share with the leader.
    let insertAt = p.prevLogIndex; // 0-based count of entries kept from the front
    let conflictTruncated = false;
    for (let k = 0; k < p.entries.length; k++) {
      const logIndex = p.prevLogIndex + k + 1; // 1-based
      if (logIndex <= n.log.length) {
        if (termAt(n, logIndex) !== p.entries[k].term) {
          // Conflict: delete this and everything after, then append the rest.
          n.log.length = logIndex - 1;
          conflictTruncated = true;
          for (let j = k; j < p.entries.length; j++) n.log.push(p.entries[j]);
          insertAt = n.log.length;
          break;
        }
        insertAt = logIndex;
      } else {
        for (let j = k; j < p.entries.length; j++) n.log.push(p.entries[j]);
        insertAt = n.log.length;
        break;
      }
    }
    if (conflictTruncated) {
      log(`n${n.id} truncates divergent entries, follows n${p.leaderId} (term ${n.currentTerm})`);
    }

    // Advance commit index to min(leaderCommit, index of last new entry) (§5.3).
    if (p.leaderCommit > n.commitIndex) {
      const lastNewIndex = p.prevLogIndex + p.entries.length;
      n.commitIndex = Math.min(p.leaderCommit, Math.max(lastNewIndex, p.prevLogIndex));
      if (n.commitIndex > n.log.length) n.commitIndex = n.log.length;
    }

    send(n.id, msg.from, "AppendEntriesReply", n.currentTerm, {
      success: true,
      matchIndex: insertAt,
    });
  }

  function handleAppendEntriesReply(n: Node, msg: Message): void {
    const p = msg.payload as AEReplyPayload;
    if (msg.term > n.currentTerm) {
      stepDown(n, msg.term, `AppendEntriesReply from n${msg.from}`);
      return;
    }
    if (n.role !== "leader" || msg.term !== n.currentTerm) return;
    if (p.success) {
      n.matchIndex[msg.from] = Math.max(n.matchIndex[msg.from], p.matchIndex);
      n.nextIndex[msg.from] = n.matchIndex[msg.from] + 1;
      maybeAdvanceCommit(n);
    } else {
      // Back off one index and retry (no conflict-term optimization; see SIMPLIFICATIONS).
      n.nextIndex[msg.from] = Math.max(1, n.nextIndex[msg.from] - 1);
    }
  }

  function maybeAdvanceCommit(n: Node): void {
    // §5.4.2: a leader only commits an entry from its CURRENT term by counting
    // replicas; earlier-term entries commit only indirectly once a current-term
    // entry above them commits. This is the safety rule that prevents committed
    // entries from being overwritten.
    for (let idx = n.log.length; idx > n.commitIndex; idx--) {
      if (termAt(n, idx) !== n.currentTerm) continue;
      let replicas = 1; // the leader itself
      for (let peer = 0; peer < NODE_COUNT; peer++) {
        if (peer === n.id) continue;
        if (n.matchIndex[peer] >= idx) replicas += 1;
      }
      if (replicas >= QUORUM) {
        if (idx > n.commitIndex) {
          n.commitIndex = idx;
          log(`n${n.id} commits up to index ${idx} (term ${n.currentTerm}, ${replicas}/${NODE_COUNT})`);
        }
        break;
      }
    }
  }

  function sendAppendEntries(n: Node, peer: number): void {
    const prevLogIndex = n.nextIndex[peer] - 1;
    const prevLogTerm = termAt(n, prevLogIndex);
    const entries = n.log.slice(prevLogIndex); // suffix from nextIndex onward
    send(n.id, peer, "AppendEntries", n.currentTerm, {
      leaderId: n.id,
      prevLogIndex,
      prevLogTerm,
      entries: entries.map((e) => ({ ...e })),
      leaderCommit: n.commitIndex,
    });
  }

  function broadcastHeartbeat(n: Node): void {
    for (let peer = 0; peer < NODE_COUNT; peer++) {
      if (peer === n.id) continue;
      sendAppendEntries(n, peer);
    }
  }

  function deliver(msg: Message): void {
    const to = nodes[msg.to];
    if (!nodes[msg.from].alive) return; // sender died after sending (dropped)
    if (!to.alive) return;
    switch (msg.kind) {
      case "RequestVote":
        handleRequestVote(to, msg);
        break;
      case "RequestVoteReply":
        handleRequestVoteReply(to, msg);
        break;
      case "AppendEntries":
        handleAppendEntries(to, msg);
        break;
      case "AppendEntriesReply":
        handleAppendEntriesReply(to, msg);
        break;
    }
  }

  function advanceMessages(dtMs: number): void {
    const arrived: Message[] = [];
    const stillFlying: Message[] = [];
    for (const msg of messages) {
      // A message on a link that is currently down (cut) is silently dropped,
      // including in-flight ones cut mid-transit.
      if (!linkUp(msg.from, msg.to)) continue;
      if (!nodes[msg.from].alive || !nodes[msg.to].alive) continue;
      msg.elapsedMs += dtMs;
      if (msg.elapsedMs >= msg.totalMs) arrived.push(msg);
      else stillFlying.push(msg);
    }
    messages = stillFlying;
    // Deliver in deterministic order: by arrival time, then by id.
    arrived.sort((x, y) => {
      const ax = x.totalMs - x.elapsedMs;
      const ay = y.totalMs - y.elapsedMs;
      if (ax !== ay) return ax - ay;
      return x.id - y.id;
    });
    for (const msg of arrived) deliver(msg);
  }

  function advanceTimers(dtMs: number): void {
    for (const n of nodes) {
      if (!n.alive) continue; // dead node: timers frozen
      if (n.role === "leader") {
        n.heartbeatElapsedMs += dtMs;
        while (n.heartbeatElapsedMs >= HEARTBEAT_INTERVAL_MS) {
          n.heartbeatElapsedMs -= HEARTBEAT_INTERVAL_MS;
          broadcastHeartbeat(n);
        }
        // A leader never times itself out.
        n.electionElapsedMs = 0;
      } else {
        n.electionElapsedMs += dtMs;
        if (n.electionElapsedMs >= n.electionTimeoutMs) {
          becomeCandidate(n);
        }
      }
    }
  }

  function doStep(dtMs: number): void {
    if (dtMs <= 0) return;
    now += dtMs;
    // Deliver messages first (a heartbeat arriving resets a follower's timer),
    // then advance timers (which may trigger elections and emit new messages).
    advanceMessages(dtMs);
    advanceTimers(dtMs);
  }

  function killNode(i: number): void {
    if (i < 0 || i >= NODE_COUNT) return;
    const n = nodes[i];
    if (!n.alive) return;
    n.alive = false;
    n.role = "dead";
    log(`n${i} killed`);
    // Drop any messages already in flight from or to this node.
    messages = messages.filter((m) => m.from !== i && m.to !== i);
  }

  function restartNode(i: number): void {
    if (i < 0 || i >= NODE_COUNT) return;
    const n = nodes[i];
    if (n.alive) return;
    // Persistent state (currentTerm, votedFor, log) is retained; volatile state
    // is reset (§5: persistent vs volatile).
    n.alive = true;
    n.role = "follower";
    n.commitIndex = 0;
    n.nextIndex = new Array(NODE_COUNT).fill(n.log.length + 1);
    n.matchIndex = new Array(NODE_COUNT).fill(0);
    n.votesGranted = new Set();
    n.electionTimeoutMs = randTimeout();
    n.electionElapsedMs = 0;
    n.heartbeatElapsedMs = 0;
    log(`n${i} restarts (term ${n.currentTerm}, log ${n.log.length})`);
  }

  function cutLink(a: number, b: number): void {
    if (a === b || a < 0 || b < 0 || a >= NODE_COUNT || b >= NODE_COUNT) return;
    const key = linkKey(a, b);
    if (downLinks.has(key)) return;
    downLinks.add(key);
    log(`link n${a}–n${b} cut`);
  }

  function healLink(a: number, b: number): void {
    if (a === b || a < 0 || b < 0 || a >= NODE_COUNT || b >= NODE_COUNT) return;
    const key = linkKey(a, b);
    if (!downLinks.has(key)) return;
    downLinks.delete(key);
    log(`link n${a}–n${b} healed`);
  }

  function partition(groups: number[][]): void {
    // Cut every link whose endpoints fall in different groups; leave intra-group
    // links as they are. Nodes not listed in any group are treated as isolated.
    const groupOf = new Map<number, number>();
    groups.forEach((g, gi) => {
      for (const id of g) {
        if (id >= 0 && id < NODE_COUNT) groupOf.set(id, gi);
      }
    });
    for (let a = 0; a < NODE_COUNT; a++) {
      for (let b = a + 1; b < NODE_COUNT; b++) {
        const ga = groupOf.get(a);
        const gb = groupOf.get(b);
        const sameGroup = ga !== undefined && gb !== undefined && ga === gb;
        const key = linkKey(a, b);
        if (sameGroup) {
          downLinks.delete(key);
        } else {
          downLinks.add(key);
        }
      }
    }
    log(`partition applied: ${groups.map((g) => `{${g.join(",")}}`).join(" | ")}`);
  }

  function healAll(): void {
    if (downLinks.size === 0) return;
    downLinks.clear();
    log(`all links healed`);
  }

  function clientWrite(): void {
    // The write goes to every node that currently believes it is a leader. A stale
    // minority leader will append locally but can never reach quorum, so the entry
    // stays uncommitted and is overwritten when it later steps down.
    const value = nextWriteValue++;
    let delivered = false;
    for (const n of nodes) {
      if (n.alive && n.role === "leader") {
        n.log.push({ term: n.currentTerm, value });
        n.matchIndex[n.id] = lastLogIndex(n);
        log(`client write v${value} -> n${n.id} (term ${n.currentTerm}, index ${n.log.length})`);
        // Replicate immediately so the viz shows entries moving.
        broadcastHeartbeat(n);
        delivered = true;
      }
    }
    if (!delivered) {
      nextWriteValue--; // no leader accepted it; do not burn the value
      log(`client write dropped — no leader reachable`);
    }
  }

  function committedValues(n: Node): number[] {
    const out: number[] = [];
    for (let i = 0; i < n.commitIndex && i < n.log.length; i++) {
      out.push(n.log[i].value);
    }
    return out;
  }

  function snapshotImpl(): RaftSnapshot {
    const nodeViews: NodeView[] = nodes.map((n) => ({
      id: n.id,
      role: n.role,
      alive: n.alive,
      currentTerm: n.currentTerm,
      votedFor: n.votedFor,
      log: n.log.map((e) => ({ ...e })),
      commitIndex: n.commitIndex,
      timerPct:
        !n.alive || n.role === "leader" ? 0 : Math.max(0, Math.min(1, n.electionElapsedMs / n.electionTimeoutMs)),
      votesGranted: [...n.votesGranted].sort((x, y) => x - y),
      committedValues: committedValues(n),
    }));

    const links: LinkView[] = [];
    for (let a = 0; a < NODE_COUNT; a++) {
      for (let b = a + 1; b < NODE_COUNT; b++) {
        links.push({ a, b, up: linkUp(a, b) });
      }
    }

    const messageViews: MessageView[] = messages.map((m) => ({
      id: m.id,
      from: m.from,
      to: m.to,
      kind: m.kind,
      term: m.term,
      progress: m.totalMs === 0 ? 1 : Math.max(0, Math.min(1, m.elapsedMs / m.totalMs)),
    }));

    return {
      now,
      nodes: nodeViews,
      links,
      messages: messageViews,
      eventLog: [...eventLog],
      electionCount,
    };
  }

  init();

  return {
    step: doStep,
    killNode,
    restartNode,
    cutLink,
    healLink,
    partition,
    healAll,
    clientWrite,
    reset: init,
    snapshot: snapshotImpl,
  };
}
