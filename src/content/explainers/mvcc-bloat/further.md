# Further — mvcc-bloat parking lot

Material deliberately cut from `index.mdx` to keep it answering one question (why
dead row versions accumulate, what is allowed to remove them, and how one held
snapshot defeats vacuum). Each item got at most a sentence in the draft; several
are future explainers.

## Index bloat (the missing half of the vacuum story)

The sim has no indexes, and the draft gives the consequence one sentence. Every
non-HOT update inserts into every index; dead index entries are reclaimed by
vacuum's index passes, which dominate vacuum runtime on indexed tables; B-tree
deduplication (PG 13) and bottom-up index deletion (PG 14) exist specifically to
blunt version-churn in indexes. An "anatomy of a vacuum run" explainer could
visualize the heap pass / index passes / heap-second-pass structure and
`maintenance_work_mem`-bounded dead-TID batching.

## Wraparound and freezing, in depth

The draft compresses freezing into one paragraph. The full story — circular
32-bit xid comparison, `relfrozenxid`/`datfrozenxid`, freeze margins
(`vacuum_freeze_min_age`, `vacuum_freeze_table_age`), aggressive vacuums, the
single-user-mode recovery ritual, and the famous multi-day outages it has caused
— is its own piece with a great "break it" interaction (race the wraparound
clock against a pinned horizon). 64-bit xid work in progress upstream would be
the closing note.

## HOT updates and fillfactor tuning

One paragraph in the draft. The mechanism deserves its own visualization: a
page-local update chain, the prune that collapses it without vacuum, the
heap-only tuple's missing index entries, and the failure case (page full or
indexed column changed) that de-HOTs the workload. The classic tuning story —
`fillfactor = 90` on a hot table flipping update patterns from index-churning to
HOT — is measurable and very visual.

## Snapshot internals

The draft treats a snapshot as "the set of committed xids at a moment." The real
structure (xmin, xmax, in-progress xip list), commit-status lookup through CLOG
with hint bits cached on the tuple, and the PG 14 snapshot-scalability rework
(GlobalVisTest, approximate horizons) are a future "how a tuple convinces a
query it exists" piece. The sim's instant-commit model deliberately erases CLOG
and hint bits.

## Other horizon holders, operationally

The draft lists them in one paragraph: `hot_standby_feedback`, stale logical or
physical replication slots, orphaned prepared transactions (`pg_prepared_xacts`),
long `pg_dump`. An ops-focused piece could walk a triage: query
`pg_stat_activity.backend_xmin`, `pg_replication_slots.xmin`,
`pg_prepared_xacts` in order and find the pin. Also cut: `old_snapshot_threshold`
(could cancel long queries to free the horizon, removed in PG 17 — citing it
would have dated the piece immediately).

## VACUUM FULL alternatives

pg_repack got one parenthetical. The trigger-based copy approach, its
double-disk requirement, the brief exclusive lock at swap time, and when a
partitioned-table rotation beats both are practical depth the single-question
rule excluded.

## MVCC done differently

Postgres keeps old versions in the heap and pays with vacuum; Oracle and MySQL
InnoDB keep the newest version in place and reconstruct old ones from undo/redo
logs, paying with rollback-segment pressure ("snapshot too old") instead of
bloat. SQL Server's tempdb version store is a third design. A comparative
"where do the old versions live" explainer pairs naturally with this one — same
sim, different reclamation rules.
