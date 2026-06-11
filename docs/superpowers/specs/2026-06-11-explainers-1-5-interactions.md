# Explainers 1–5 — Core interaction specs

Derived from the PRD roadmap (which the user approved); built while the user is away per their direct instruction
("implement at least 5 explainers with simulations"). User reviews these specs, the verification checklists, and all
content before the site deploys (Cloudflare connect is still parked, so nothing is public until then).

## 1. How a write-ahead log survives a crash (`wal-crash-recovery`)

- **Core interaction:** A live WAL strip + data-page grid; the reader crashes the database at any instant — including
  mid-write and mid-fsync — then steps through recovery replay record by record.
- **Reader controls:** `Commit` (single transaction), `Load` toggle (workload generator → group commit visible),
  `fsync on commit` toggle, `Crash` (always armed), stepped `Recover` replay, `Reset`, speed.
- **What they can break:** (a) toggle fsync off, crash → acknowledged commits silently lost on recovery; (b) crash
  mid-write → torn tail record detected (checksum) and truncated during recovery.
- **What breaking teaches:** durability is the fsync barrier ordering (log record durable before the page can be),
  and recovery = deterministic replay of records ≤ last durable LSN.
- **Supporting viz:** live counters (last LSN, last durable LSN, commits acked vs. survived).

## 2. Raft leader election, but you control the network (`raft-leader-election`)

- **Core interaction:** A 5-node cluster with visible election timers and terms; the reader cuts links, partitions
  groups, and kills leaders, trying to cause split-brain — and watches the protocol refuse.
- **Reader controls:** click node → kill/restart; partition presets (isolate leader, 2/3 split, heal all); speed;
  `Reset`. Live per-node state: term, role, votes, timer.
- **What they can break:** partition the leader into a minority → it keeps claiming leadership in its old term but
  can't commit; the majority elects a new leader in a higher term; on heal, the old leader steps down.
- **What breaking teaches:** at most one leader per term; quorum intersection (not timers, not heartbeats) is what
  prevents two committing leaders.
- **Supporting viz:** per-node log panel showing term/votedFor; commit-index marker.

## 3. What PgBouncer actually does to your connections (`pgbouncer-pool-modes`)

- **Core interaction:** Clients → pooler → Postgres backends drawn as live lanes; the reader switches
  session/transaction/statement pooling modes and watches server-connection reuse change shape.
- **Reader controls:** pool mode selector, client count, `default_pool_size`, query rate, `PREPARE` toggle on
  clients, `Reset`.
- **What they can break:** (a) transaction mode + protocol-level prepared statements → "prepared statement does not
  exist" errors when a client lands on a backend that never saw its PREPARE; (b) saturate the pool → wait-queue
  growth and `query_wait_timeout` expirations.
- **What breaking teaches:** pooling modes trade session-state compatibility for multiplexing; a server connection is
  shared mutable state.
- **Supporting viz:** pool occupancy meter + wait-queue depth counter.

## 4. How durable workflow engines replay history (`temporal-deterministic-replay`)

- **Core interaction:** A workflow's event history as a tape; the reader crashes the worker mid-workflow and watches
  deterministic replay rebuild state from the tape; then injects a `time.Now()` nondeterminism and watches replay
  diverge and fail.
- **Reader controls:** `Run` (workflow progresses through activities; events append), `Crash worker`, stepped
  `Replay`, `Inject time.Now()` toggle, `Reset`.
- **What they can break:** the nondeterministic workflow — on replay the command stream no longer matches recorded
  events → nondeterminism error, workflow task fails.
- **What breaking teaches:** the event history is the source of truth; workflow code is a deterministic function
  replayed against it; activity results come from history, not re-execution.
- **Supporting viz:** side-by-side "recorded events" vs "replay commands" comparison strip.

## 5. LSM trees: write fast now, pay later (`lsm-tree-compaction`)

- **Core interaction:** Writes flow into a memtable; the reader triggers flushes and compactions and watches SSTables
  merge; a read-amplification meter tracks the cost of every point read.
- **Reader controls:** `Write` (auto-load toggle + manual), `Flush memtable`, `Compact`, `Read key` (traces the
  lookup path memtable → L0 → L1), `Delete key` (tombstone), `Reset`.
- **What they can break:** keep writing while never compacting → L0 SSTables pile up, read amplification climbs, the
  traced read path visibly lengthens; tombstones accumulate until compaction drops them.
- **What breaking teaches:** an LSM buys write throughput by deferring merge work; compaction is the bill, and read
  amplification is what unpaid bills look like.
- **Supporting viz:** read/write/space amplification counters; per-level SSTable count.

## Process per explainer (interactive-explainer skill order)

interaction spec (above) → sim core in `sim/` with Vitest invariant tests → React island(s) in `components/` per
viz-patterns.md → prose in `index.mdx` → verification pass against the PRD's primary sources (claims checklist
committed to the explainer folder as `verification.md`) → edge-state QA. Content review (technical + voice) by
independent reviewers before each is marked done. All five ship `draft: false` in the repo but remain unpublished
until the user reviews and connects the deploy.
