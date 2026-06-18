# Further — xid-wraparound parking lot

Material deliberately cut from `index.mdx` to keep it answering one question (why
the xid clock is finite, what freezing does, and how a pinned horizon stalls it
to the point of an outage). Promised by the MVCC piece's parking lot; several
items below are their own future explainers.

## MultiXact wraparound (the second clock)

There is a whole parallel wraparound problem on `multixact` IDs — the structures
that track multiple transactions locking one row (`SELECT … FOR SHARE`, foreign
keys). `autovacuum_multixact_freeze_max_age`, `members` storage exhaustion in
`pg_multixact`, and the fact that a workload heavy on row-share locks can hit the
multixact wall while the xid clock looks fine. A "the other wraparound nobody
watches" piece. The sim models only the xid clock.

## 64-bit xids

The upstream work to widen xids (and the epoch-based `FullTransactionId` already
used internally for some bookkeeping) would retire this entire failure mode. The
history — why it's hard (on-disk tuple header size, every index, pg_upgrade), the
several abandoned attempts, and what the current proposal does — is a worthwhile
"how Postgres plans to kill its scariest outage" piece.

## The freeze cost model and aggressive vacuum

The draft says freezing is I/O and scales with unfrozen pages. The full picture —
the visibility map's all-visible vs all-frozen bits, why `VACUUM (FREEZE)` and an
aggressive vacuum differ, page-level freezing (PG 14+) that freezes a whole page
at once, and the opportunistic freezing heuristics added in recent versions — is
an "anatomy of a freeze" explainer. The sim's instant relfrozenxid jump hides all
of it.

## The actual recovery ritual

Single-user mode (`postgres --single`), why the database won't start normally,
the order of operations (find the holder, kill it, then `VACUUM`), and the
`vacuumdb --all --freeze` path on a still-running cluster that's only warning, not
yet refusing. An ops runbook piece. The sim compresses recovery into one freeze.

## datfrozenxid bookkeeping and template0

How `datfrozenxid` is maintained, why `template0` is frozen and connection-locked,
and the `pg_database` / `pg_class` queries to find the oldest table. Practical
monitoring depth the draft gives one query.

## CLOG / pg_xact and commit_ts truncation

Freezing is what lets Postgres truncate the commit-log SLRUs (`pg_xact`,
`pg_commit_ts`). The relationship — old commit status can be discarded only once
the xids it describes are all frozen — and the disk/`commit_ts` sizing the docs
quote (≈50 MB / ≈2 GB at 200M) is a storage-side companion to this piece.

## The famous outages

Sentry, Mailchimp, Joyent, and others published wraparound postmortems with
different root causes (autovacuum disabled, long transactions, replication slots).
A comparative read of real incidents — what pinned the horizon, what the first
symptom was, how long recovery took — would make the abstract failure concrete.
Kept out of the draft because it's secondary-source storytelling, not mechanism.
