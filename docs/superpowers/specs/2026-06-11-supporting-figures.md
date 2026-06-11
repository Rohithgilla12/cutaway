# Supporting figures — one per explainer (user-requested)

The PRD's "one interaction per explainer" principle governs the CORE interaction; it explicitly allows 0–3 supporting
visualizations. These add a second interactive figure per post, embedded where the prose currently only asserts.
Each follows the same rules as core components: pure tested mini-sim (where stateful), sim/render split, tokens,
reduced motion, 360px, one aria-live region, Figure wrapper with the next FIG number.

| # | Explainer | Supporting figure (FIG. 02) | Placement | Breakable/insight |
|---|-----------|------------------------------|-----------|-------------------|
| 1 | WAL | Naive fsync-per-page vs WAL append: two lanes consuming the same commit stream; left pays N random page fsyncs per commit, right pays one sequential append+batched fsync. Commits/s + queue depth per lane. | "Why it breaks" | Crank the commit rate; naive lane's queue grows unbounded while WAL lane keeps up — the random-write tax made visible. |
| 2 | Raft | Quorum overlap: 5 nodes; reader selects any majority (3) as group A, then any majority as group B; the intersection is always highlighted non-empty. | "The real mechanism" (quorum paragraph) | Try to pick two disjoint majorities — impossible; THIS is what forbids two committing leaders, not timing. |
| 3 | PgBouncer | The cost of a backend: connections slider 10→5,000; per-backend memory baseline + work_mem multiplier bars vs a pooled column (clients vs pool_size). Numbers labeled as estimates with the real parameter names. | "Why it breaks" | Slide to 5,000 and watch the memory bar pass typical RAM — the reason max_connections isn't the fix. |
| 4 | Temporal | The naive sweeper double-charge: charge → mark-charged state machine with a cron sweeper; reader crashes between charge and mark; sweeper retries → charge runs again, double-charge counter goes red. | "Why it breaks" | Crash in the gap; retry double-charges. Recorded results (history) are the cure the core figure then demonstrates. |
| 5 | LSM | Bloom filter: bit array (64 bits, k=3 seeded hashes); reader adds keys, queries members and non-members; probes skipped vs false-positive counter. | Real-world grounding (bloom paragraph) | Query enough non-members to land a false positive — and observe there is never a false negative. |

Mini-sim invariants to test: (1) WAL-naive: same workload, naive throughput ≤ WAL throughput; naive queue monotonic
under saturation; deterministic. (2) Quorum: every pair of 3-subsets of 5 intersects (exhaustive). (3) Backend cost:
math pure function, monotonic in connections. (4) Sweeper: crash between charge and mark ⇒ retry increments charge
count to 2 for that order; without crash ⇒ exactly 1. (5) Bloom: zero false negatives ever (sweep); false positives
possible and counted; deterministic for same seed.
