# Verification checklist — mvcc-bloat (explainer #6)

Step 5 verification pass. Every checkable technical claim from the prose and component
captions, verified against PRIMARY sources only: postgresql.org/docs/current and the
PostgreSQL source tree. Blog/SO answers are not verification sources.

Legend: ✅ verified (source + confirming text) · ⚠️ simplification (must be labeled in prose —
checked it IS) · ❌ wrong/unverifiable (fixed or cut).

Primary sources used:

- PG Routine Vacuuming: https://www.postgresql.org/docs/current/routine-vacuuming.html
- PG autovacuum config defaults: https://www.postgresql.org/docs/current/runtime-config-vacuum.html
- PG Transaction Isolation: https://www.postgresql.org/docs/current/transaction-iso.html
- PG Transactions and Identifiers: https://www.postgresql.org/docs/current/transaction-id.html
- PG Page Layout: https://www.postgresql.org/docs/current/storage-page-layout.html
- PG HOT: https://www.postgresql.org/docs/current/storage-hot.html
- PG MVCC intro: https://www.postgresql.org/docs/current/mvcc-intro.html
- PG monitoring stats: https://www.postgresql.org/docs/current/monitoring-stats.html
- PG client config (idle_in_transaction_session_timeout): https://www.postgresql.org/docs/current/runtime-config-client.html
- PG replication config (hot_standby_feedback): https://www.postgresql.org/docs/current/runtime-config-replication.html
- PG pg_dump: https://www.postgresql.org/docs/current/app-pgdump.html
- PG source, procarray.c (ComputeXidHorizons): https://github.com/postgres/postgres/blob/master/src/backend/storage/ipc/procarray.c

Cross-check method: the coached experiments in the FIG. 01 caption and prose were executed
against the actual sim core (seed `0x5eed_c0de`) via a throwaway vitest harness; results
quoted under section F.

---

## A. MVCC model and tuple mechanics

1. **"Postgres never updates a row in place … a deleted row is not removed at all, only
   marked"** ✅ routine-vacuuming: "an UPDATE or DELETE of a row does not immediately remove
   the old version of the row … the row version must not be deleted while it is still
   potentially visible to other transactions."
2. **"reading never blocks writing and writing never blocks reading" / readers and writers
   never queue behind each other** ✅ mvcc-intro: verbatim "reading never blocks writing and
   writing never blocks reading."
3. **`xmin` = creating xid, `xmax` = invalidating xid, zero while current** ✅
   storage-page-layout, HeapTupleHeaderData: `t_xmin` "insert XID stamp", `t_xmax` "delete XID
   stamp"; 0 == no deleter. Prose uses the catalog-column names `xmin`/`xmax`, which is what a
   reader sees in `SELECT xmin, xmax FROM …`.
4. **"snapshot … decides version-by-version: visible if its creator committed before my
   snapshot and its invalidator did not"** ⚠️ simplification of HeapTupleSatisfiesMVCC (real
   rule also consults the snapshot's in-progress list, CLOG commit status, hint bits, and the
   inserting/deleting transaction being _my own_). Labeled: sim SIMPLIFICATIONS item 1 and the
   "What real Postgres adds" paragraph ("every workload transaction commits instantly — real
   visibility checks consult commit status").
5. **UPDATE = INSERT new version + stamp old version's xmax; DELETE = the marking alone** ✅
   routine-vacuuming (claim 1) + storage-page-layout; also interdb.jp ch. 5 structure matches.
6. **8 KB pages, dozens-to-hundreds of tuples** ✅ storage-page-layout: "pages of a fixed size
   (usually 8 kB)". Sim's 4-tuple/16-page geometry labeled in SIMPLIFICATIONS and prose.

## B. Vacuum and the horizon

1. **Vacuum may remove a dead version only if its xmax is below the oldest xmin ("horizon")**
   ✅ routine-vacuuming ("must not be deleted while it is still potentially visible") +
   procarray.c `ComputeXidHorizons` comments: horizons are minima over backend xids/xmins;
   tuples whose xmax precedes the horizon are "definitely dead to all current and future
   transactions". The strict `<` boundary in `classifyTuple` matches `NormalTransactionIdPrecedes`
   usage in vacuum's removability test.
2. **Horizon = min over open snapshots; production adds replication slots, prepared
   transactions, walsenders** ✅ procarray.c ComputeXidHorizons comments; routine-vacuuming
   triage list (long transactions, replication slots, prepared transactions). Sim's
   single-snapshot horizon labeled in SIMPLIFICATIONS item 3.
3. **A version no snapshot can see survives anyway if xmax ≥ horizon (guillotine, not
   scalpel)** ✅ consequence of the xmax-vs-horizon rule (B1): removability is computed against
   the global horizon, not per-snapshot visibility. Encoded and tested in
   `visibility.test.ts` ("keeps the invisible-to-everyone intermediate version"). HOT pruning
   uses the same horizon, so same-page pruning does not invalidate the claim (storage-hot
   describes pruning of versions "no longer visible to any transaction" — gated by the same
   oldest-xmin computation).
4. **Vacuum log line "dead but not yet removable" naming `oldest xmin`** ✅ PG source
   `src/backend/access/heap/vacuumlazy.c`: "%lld dead row versions cannot be removed yet,
   oldest xmin: %u" / log_autovacuum output "tuples: … dead but not yet removable". Sim log
   format mirrors it.
5. **Plain VACUUM does not return space to the OS except trailing empty pages** ✅
   routine-vacuuming: "it will not return the space to the operating system, except in the
   special case where one or more pages at the end of a table become entirely free and an
   exclusive table lock can be easily obtained." Sim models exactly this (interior slots
   reusable, trailing-page truncation only); the easily-obtained-lock condition is omitted
   (vacuum here is instantaneous — SIMPLIFICATIONS item 8).
6. **VACUUM FULL rewrites into a fresh file, ACCESS EXCLUSIVE lock, extra disk for the copy**
   ✅ routine-vacuuming: "writing a complete new version of the table file with no dead space"
   / "requires an ACCESS EXCLUSIVE lock" / "requires extra disk space … until the operation
   completes."
7. **pg_repack: same rewrite, much shorter lock window** ✅ pg_repack documentation (the
   tool's own docs; primary for the tool): online rebuild with brief exclusive lock at swap.
   One parenthetical, no parameters claimed.

## C. The long transaction

1. **REPEATABLE READ takes its snapshot at the first statement and holds it for the
   transaction** ✅ transaction-iso: "sees a snapshot as of the start of the first
   non-transaction-control statement in the transaction."
2. **READ COMMITTED takes a fresh snapshot per statement** ✅ transaction-iso: "Read Committed
   mode starts each command with a new snapshot."
3. **Read-only transactions are never assigned a (permanent) transaction ID; xids are handed
   out at the first write** ✅ transaction-id: "This assignment happens when a transaction
   first writes to the database"; read-only transactions carry only virtual IDs.
4. **An idle-in-transaction session prevents vacuuming recently-dead tuples and contributes
   to bloat; the defense is `idle_in_transaction_session_timeout`** ✅ runtime-config-client:
   "an open transaction prevents vacuuming away recently-dead tuples that may be visible only
   to this transaction; so remaining idle for a long time can contribute to table bloat."
5. **`pg_stat_activity` exposes `state = 'idle in transaction'` and `backend_xmin`; alarm on
   oldest-xmin age** ✅ monitoring-stats: backend_xmin "The current backend's xmin horizon";
   routine-vacuuming triage: "checking pg_stat_activity for rows where age(backend_xid) or
   age(backend_xmin) is large."
6. **hot_standby_feedback extends standby queries' xmin to the primary, can bloat the
   primary** ✅ runtime-config-replication: "can cause database bloat on the primary for some
   workloads."
7. **Stale replication slot pins the horizon indefinitely; orphaned prepared transaction holds
   it until resolved; pg_dump is one long transaction for this purpose** ✅ routine-vacuuming
   triage list (slots via pg_replication_slots xmin age, prepared xacts via pg_prepared_xacts);
   app-pgdump: "makes consistent exports even if the database is being used concurrently" —
   i.e., it holds a snapshot for the duration.

## D. Autovacuum and wraparound

1. **Autovacuum wakes every `autovacuum_naptime` (default 1 min); vacuums when dead tuples
   exceed threshold + scale_factor × reltuples; defaults 50 and 0.2; PG 18 caps with
   `autovacuum_vacuum_max_threshold` default 100 M** ✅ runtime-config-vacuum: all four
   defaults verbatim ("The default is 50 tuples" / "0.2 (20% of table size)" / "one minute" /
   "100,000,000 tuples"). The 50 M-row → 10 M dead example: 50 + 0.2 × 50 M = 10,000,050,
   below the 100 M cap, so the example holds on PG 18 too. Sim threshold (4 + ⌈0.2·8⌉ = 6) is
   the same formula scaled down, stated in prose.
2. **Xids 32-bit, compared circularly; must vacuum/freeze within ~two billion** ✅
   routine-vacuuming: "transaction IDs have limited size (32 bits)" / "necessary to vacuum
   every table in every database at least once every two billion transactions."
3. **Aggressive anti-wraparound vacuum forced at `autovacuum_freeze_max_age` default 200 M**
   ✅ runtime-config-vacuum + routine-vacuuming: "the default is a relatively low 200 million
   transactions."
4. **Then warnings, then refusal to assign new xids** ✅ routine-vacuuming: warnings at 40 M
   from wraparound; "the system will refuse to assign new XIDs once there are fewer than three
   million transactions left." Prose stays general ("warning loudly, and ultimately refusing to
   assign new transaction IDs until vacuumed") — consistent.
5. **Freezing = marking tuples "committed in the infinite past"** ✅ routine-vacuuming:
   frozen rows "are treated as if the inserting transaction had committed in the distant
   past" (prose paraphrase "infinite past" matches FrozenTransactionId semantics).

## E. HOT and indexes

1. **HOT possible when no indexed column changed and the old version's page has room; no new
   index entries; later queries can prune without vacuum** ✅ storage-hot: both conditions,
   "New index entries are not needed", pruning "during normal operation, including SELECTs."
   (Summary/BRIN-index nuance omitted — one-sentence altitude.)
2. **`fillfactor` is the headroom knob for HOT** ✅ storage-hot performance tip.
3. **Every non-HOT update inserts into every index; dead index entries are bloat; index passes
   dominate vacuum runtime** ✅ storage-hot (index-entry claim); routine-vacuuming (vacuum
   processes indexes); "usually where its time actually goes" is stated as tendency, supported
   by maintenance_work_mem/index-pass structure in the docs. Sim has no indexes —
   SIMPLIFICATIONS item 5 and labeled in prose.

## F. Sim/prose cross-check (executed against the sim core, seed 0x5eed_c0de)

1. **"workload + autovacuum … page count settles at a small multiple of the minimum"** ✅
   harness: 60 sim-seconds of workload+autovacuum → pages steady at 4 (minimum 2), max bloat
   2.0×. The 3× danger threshold on the bloat stat never trips in the healthy state.
2. **"bloat ratio climbs through 2×, 3× … until the table hits the 16-page disk cap and
   updates start failing"** ✅ harness: horizon pinned under the same workload → diskFull=true
   after ~14 s, pages 16/16, bloat 8.0×, deadPinned 56, updates refused (logged).
3. **"Autovacuum keeps firing … removing nothing … naming the held oldest xmin"** ✅ harness:
   autovacuum ran while pinned with removed=0, kept=56, oldestXmin=341 (the held snapshot).
4. **"commit … one more vacuum: everything amber goes gray and gets swept … page count stays
   at its high-water mark"** ✅ harness: after closeLongTxn+vacuum → dead 0, free slots 56,
   pages still 16 (no trailing truncation; live tuples scattered to the last page).
5. **Boundary: a version deleted by xid == snapshot xmin stays pinned and visible to the
   snapshot** ✅ unit test "a version deleted at the exact horizon xid is pinned (boundary)".
6. **Determinism/reset** ✅ unit tests "same seed, same schedule, same snapshot" and "reset
   reproduces the initial state."

## G. Component captions

1. FIG. 01 caption (four experiments) ✅ matches F1–F4 trajectories above.
2. FIG. 02 caption ("slide the snapshot xmin left of xmax: removable → pinned; left of xmin
   too: invisible but still pinned") ✅ direct restatement of `visibleToSnapshot`/`classifyTuple`,
   unit-tested in visibility.test.ts, including the invisible-but-pinned case.

## Resolution log

- ❌→fixed: an earlier draft claimed an idle read-only READ COMMITTED session "usually pins
  nothing between statements." Directionally true at source level (snapmgr xmin advancement)
  but not verifiable against the docs, which warn the opposite for any idle-in-transaction
  session. Rewritten to the docs-backed claim (C4) plus the xid-pinning caveat (C3).
- Deliberately NOT cited: `old_snapshot_threshold` (removed in PG 17); pre-PG14 "1 million
  xids" shutdown folklore (current docs say 3 million, and it refuses xid assignment rather
  than shutting down).
