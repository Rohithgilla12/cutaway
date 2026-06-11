# Launch thread — X/Twitter (drafted 2026-06-11, not yet posted)

Primary version leads with the PgBouncer error string (strongest hook — renders like a log line in the timeline).

## Lead post

```
ERROR: prepared statement "S_1" does not exist

If you've run PgBouncer in transaction mode, you've met this error. I built an
interactive explainer where you reproduce it in four clicks — and watch exactly
why it happens: https://cutaway.gilla.fun/pgbouncer-pool-modes/

Part of cutaway, 5 explainers where you break systems and watch 🧵
```

## Thread

```
2/ The same post lets you saturate the pool — 16 clients, pool_size 1, high
load — and watch the FIFO wait queue grow until query_wait_timeout starts
killing waiters. Plus a slider showing why 5,000 raw backends costs ~68 GB of
RAM.
```

```
3/ How a write-ahead log survives a crash — toggle fsync off, commit a few
transactions, pull the power. The "lost" counter tells you which acknowledged
commits never made it to disk.
https://cutaway.gilla.fun/wal-crash-recovery/
```

```
4/ Raft leader election, but you control the network — cut links between 5
nodes and try to elect two leaders. The protocol refuses, and you can see which
rule stops you. Bonus: try to pick two majorities of 5 that don't overlap.
https://cutaway.gilla.fun/raft-leader-election/
```

```
5/ How durable workflow engines replay history — crash a worker mid-workflow,
watch deterministic replay rebuild its state from the event tape. Then add one
time.Now() and watch replay fail with the exact mismatch.
https://cutaway.gilla.fun/temporal-deterministic-replay/
```

```
6/ LSM trees: write fast now, pay later — keep writing with compaction off and
watch read amplification climb. One compaction press shows the bill being paid.
There's also a bloom filter you can poke until it lies to you.
https://cutaway.gilla.fun/lsm-tree-compaction/
```

```
7/ Every simulation is real tested code, not animation — recovery invariants,
election safety, and quorum math hold under property tests. Every claim
verified against primary sources (Postgres docs, the Raft paper, RocksDB wiki),
cited in each post.

Built in public: https://github.com/Rohithgilla12/cutaway
```

## Alternative lead (general, no error-string hook)

```
I built cutaway — interactive explainers of systems internals where you break
things and watch what happens.

Kill a database mid-fsync. Partition a Raft leader and try to cause
split-brain. Crash a Temporal worker and replay its history.

5 explainers, all free: https://cutaway.gilla.fun
```

## Notes

- Drop the 🧵 emoji if preferred; the closing line carries without it.
- Posting order matters less than the lead; tweets 2-6 can be reordered.
- Attach a screenshot or short screen recording of the PgBouncer figure erroring
  to the lead post if possible — motion of the red error pulses outperforms
  static text.
