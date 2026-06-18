# Further — isolation-anomalies parking lot

Material deliberately cut from `index.mdx` to keep it answering one question
(what each isolation level buys, framed as the anomalies it stops permitting).
Each is a sentence in the draft at most; several are their own explainers.

## Dirty reads and READ UNCOMMITTED

The fourth standard anomaly (reading another transaction's uncommitted write)
got one parenthetical: Postgres never permits it, running `READ UNCOMMITTED`
as Read Committed. A comparative piece could show a database that *does* allow
dirty reads (the standard permits them at the lowest level) and why MVCC engines
structurally cannot — there is no "uncommitted version" a reader is allowed to
land on. Out of scope: the sim has only the three Postgres behaviors.

## The SSI implementation, in depth

The draft states the pivot theorem and names `SIRead` locks. The real mechanics
deserve their own treatment: predicate-lock granularity (tuple → page → relation)
and the escalation that trades false-positive rate for memory; the
`SerializableXactHashLock` and the conflict-tracking structures; the read-only
transaction optimization (a read-only transaction can be exempted from causing an
abort under a "safe snapshot"); and the deferred read-only transaction. The
Ports & Grittner VLDB paper is the map. A "why Serializable aborts a transaction
that would have been fine" piece could make the false-positive surface tangible.

## Materializing the conflict

The draft mentions locking a sentinel row to turn write skew into a write-write
conflict the lower levels catch. The full pattern — `SELECT … FOR UPDATE` on a
parent/summary row, `SERIALIZABLE READ ONLY DEFERRABLE`, advisory locks, and
exclusion constraints (`EXCLUDE USING gist`) for the booking-overlap case — is a
practical "enforce a multi-row invariant without Serializable" explainer.

## First-updater-wins vs first-committer-wins

The draft uses first-updater-wins (Postgres's actual rule: the writer blocks on
the row lock, then aborts if the holder committed). Oracle and some SI
descriptions use first-committer-wins, where writers don't block and the conflict
is resolved at commit. The distinction (blocking vs optimistic, and what each does
to throughput under contention) is a comparative database-internals topic.

## Retry strategy and contention collapse

The draft says "write the retry loop" but not how. Backoff, jitter, retry caps,
and the failure mode where a hot Serializable workload spends more time retrying
than committing (livelock-ish contention collapse) is an operational piece with a
good interaction: a load knob that drives the abort rate up until throughput
falls off a cliff.

## Other engines' answers

MySQL/InnoDB's Repeatable Read uses next-key locking (gap locks) to prevent
phantoms rather than a frozen snapshot, with very different blocking behavior;
SQL Server's `SNAPSHOT` vs `READ COMMITTED SNAPSHOT`; CockroachDB and FoundationDB
defaulting to serializable. A cross-engine "everyone spells Repeatable Read
differently" comparison is its own piece. The sim is Postgres-only by design.

## The standard's phenomena vs the real ones

Berenson et al. showed the ANSI phenomena (P1/P2/P3) are ambiguous and that the
levels are better defined by locking or by the broader phenomena (P4 lost update,
A5A read skew, A5B write skew). The history — why the standard's English-language
anomaly definitions don't pin down the levels they were meant to, and how snapshot
isolation slips between them — is a worthwhile "the spec is underspecified" read.
