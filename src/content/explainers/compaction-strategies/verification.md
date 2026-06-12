# Verification checklist — compaction-strategies (explainer #7)

Step 5 verification pass. Every checkable technical claim from the prose and component
captions, verified against PRIMARY sources only: the RocksDB wiki and source headers, the
Apache Cassandra docs, and the RUM conjecture paper. Blog/SO answers are not verification
sources.

Legend: ✅ verified (source + confirming text) · ⚠️ simplification (must be labeled in prose —
checked it IS) · ❌ wrong/unverifiable (fixed or cut).

Primary sources used:

- RocksDB wiki, Leveled Compaction: https://github.com/facebook/rocksdb/wiki/Leveled-Compaction
- RocksDB wiki, Universal Compaction: https://github.com/facebook/rocksdb/wiki/Universal-Compaction
- RocksDB wiki, Write Stalls: https://github.com/facebook/rocksdb/wiki/Write-Stalls
- RocksDB source, include/rocksdb/advanced_options.h (defaults)
- RocksDB source, include/rocksdb/universal_compaction.h (defaults)
- Cassandra docs, Compaction overview: https://cassandra.apache.org/doc/latest/cassandra/managing/operating/compaction/overview.html
- Athanassoulis et al., "Designing Access Methods: The RUM Conjecture", EDBT 2016:
  https://cs-people.bu.edu/mathan/publications/edbt16-athanassoulis.pdf

Cross-check method: every quantitative claim the coached experiments make was executed
against the actual sim core via a throwaway vitest harness (seed 42 sweep across ingest
rates; results under section E) and is also encoded as unit tests ("write stall and strategy
trade-offs" describe block).

---

## A. Leveled compaction

1. **"L1 through L3 hold one run each. That single-run-per-level invariant is the whole
   strategy"** ✅ Leveled Compaction wiki: "Each level (except level 0) is one data sorted
   run." Unit-tested: "leveled at rest holds at most one run per level above L0."
2. **L0 runs overlap; the L0→L1 compaction picks up all L0 files** ✅ wiki: "Normally we have
   to pick up all the L0 files because they usually are overlapping." Sim merges all L0 runs.
3. **"Each level holds roughly ten times the one above it"** ✅ advanced_options.h:
   `max_bytes_for_level_multiplier = 10`. Sim's 4× ratio labeled in prose ("ours is 4× over
   four so you can see every run") and SIMPLIFICATIONS item 1.
4. **"a byte that descends the whole tree gets rewritten on the order of ten times per level
   in the worst case. Total write amplification in the tens is normal for leveled"** ✅ wiki
   acknowledges leveled write amplification "often larger than 10"; the per-level ≈multiplier
   bound is the standard analysis (DDIA ch. 3 / Database Internals Part I), phrased as
   "worst case" and "on the order of."
5. **Compaction triggers at `level0_file_num_compaction_trigger = 4`** ✅ verified for
   explainer #5 against options.h (same source, same default); sim's MERGE_TRIGGER_RUNS = 4.

## B. Write stalls

1. **"throttled at `level0_slowdown_writes_trigger = 20`, stopped outright at
   `level0_stop_writes_trigger = 36`"** ✅ advanced_options.h: `int
level0_slowdown_writes_trigger = 20;` ("We start slowing down writes at this point") and
   `int level0_stop_writes_trigger = 36;` ("We stop writes at this point").
2. **"siblings keyed on memtable count and pending-compaction bytes"** ✅ Write Stalls wiki:
   stalls on `max_write_buffer_number` (memtables waiting to flush) and
   soft/hard_pending_compaction_bytes limits.
3. **Hook LOG line "Stalling writes because we have 20 level-0 files"** ✅ Write Stalls wiki
   quotes exactly this log format ("Stalling writes because we have 4 level-0 files");
   "20" instantiates it at the slowdown default.
4. **"a designed back-pressure mechanism" / stall is documented, configurable behavior** ✅
   Write Stalls wiki, passim.
5. **Sim stall = binary stop at 8 runs that drops writes onto a counter** ⚠️ deliberately
   simplified; labeled in prose ("our stall drops writes onto a counter where the real engine
   blocks them into a latency spike instead — same mechanism, gentler rendering") and
   SIMPLIFICATIONS item 3.

## C. Tiered / universal compaction

1. **"Let runs of similar size accumulate and merge them only when enough pile up — tiered
   (RocksDB: universal; Cassandra: size-tiered)"** ✅ Universal Compaction wiki: "sometimes
   called 'size tiered'", "waits for several sorted runs with similar size and merge them
   together."
2. **Lower write amplification, higher read/space amplification** ✅ wiki: "far better write
   amplification with worse read amplification"; space cost documented separately (C3, C4).
3. **"full compaction temporarily doubles disk usage"** ✅ wiki: "both of input files and the
   output file need to be kept, so the DB will be temporarily double the disk space usage. Be
   sure to keep enough free space for full compaction."
4. **`max_size_amplification_percent`, default 200** ✅ universal_compaction.h: constructor
   default `max_size_amplification_percent(200)`; wiki describes the all-files compaction it
   triggers.
5. **Sim's tiered merges ALL runs of an overfull tier** ⚠️ real universal picks subsets by
   size ratio; labeled in SIMPLIFICATIONS item 6 and the further.md parking lot.

## D. Cassandra and the RUM conjecture

1. **STCS is Cassandra's default; triggers at `min_threshold = 4` similar-sized SSTables** ✅
   Cassandra compaction docs: "STCS is the default compaction strategy"; min_threshold
   default 4, "Lower limit of number of SSTables before a compaction is triggered."
2. **LCS for read-heavy and update-heavy tables** ✅ docs: "optimized for read heavy
   workloads, or workloads with lots of updates and deletes." (An earlier draft attributed
   the write-amplification caveat to the Cassandra docs, which don't state it; reworded to
   tie it to the leveled analysis instead — see resolution log.)
3. **TWCS for TTL'd time-series; sidesteps cross-window merging** ✅ docs: "designed for
   TTL'ed, mostly immutable time-series data."
4. **RUM conjecture: read/update/memory overheads; driving two down lets the third grow;
   attribution EDBT 2016** ✅ paper (BU mirror): the three overheads and the claim that
   optimizing two necessarily grows the third; title/venue confirmed.
5. **"an in-place B-tree picks low read and space amplification and pays with random-write
   update cost"** ✅ RUM paper's own positioning of update-optimized vs read-optimized
   structures; consistent with explainer #5's B-tree section.

## E. Sim/prose cross-check (seed-42 sweep, 120 sim-seconds per cell)

1. **"leveled at 6/s … writeAmp settles around 4"** ✅ harness: leveled@6 → WA 4.43, zero
   stalls, levels 1–3 at one run each.
2. **"flip to tiered … WriteAmp drops toward 3 … runs and spaceAmp grow"** ✅ harness:
   tiered@6 → WA 3.21, SA 2.41 (vs leveled 2.06), run count max 10 (vs 5).
3. **"drag ingest to 16/s under leveled and meet the write stall"** ✅ harness: leveled@16 →
   37% of ticks stalled, 697 writes refused, L0 pinned at the stop trigger (8). Unit test
   asserts L0 never exceeds the trigger and the first stall happens exactly at it.
4. **"flip to tiered during the stall and watch it drain … spaceAmp climbs past 3×"** ✅
   harness: tiered@16 → stalls drop to 25% with SA 7.12; tiered@12 → SA 5.37 vs leveled 2.72.
   Encoded as the "leveled pays in stalls, tiered pays in space and runs" unit test.
5. **"Push the slider to 20/s and both eventually stall"** ✅ harness: leveled@20 54% /
   tiered@20 28% stalled ticks — flush demand alone approaches the 24/s budget.
6. **"Full compact … on-disk meter rises before it falls"** ✅ unit test "space amplification
   … full compaction drives it to 1" asserts the transient peak exceeds the pre-compaction
   footprint, then runCount = 1 and SA = 1.
7. **Read correctness under both strategies, mid-merge and across strategy switches** ✅
   oracle-sweep unit tests (a merge-order bug — compaction output seq vs content recency —
   was caught by exactly this test during development and fixed).

## F. Component captions

1. FIG. 01 caption (four experiments) ✅ matches E1–E3, E6.
2. FIG. 02 caption ("at 10/s the meters separate cleanly: leveled stalls first and tiered
   hoards disk") ✅ harness: leveled@10 15% stalled / 175 refused vs tiered@10 4% / 43;
   SA 5.13 (tiered) vs 2.85 (leveled).

## Resolution log

- ❌→fixed: "the [Cassandra] docs noting its higher write-amplification cost" — the docs
  page describes LCS as read/update-optimized but does not price its write amplification.
  Reworded to attribute the cost to the leveled analysis, not the Cassandra docs.
- ❌→fixed (dead link): the RUM paper URL initially pointed at a Harvard mirror that 404s;
  replaced with the author's BU mirror, fetched and confirmed.
- Sim bug caught by verification-grade tests, recorded for honesty: compaction outputs carry
  the newest creation seq but older _content_ than runs flushed during the merge; resolving
  merge recency by raw seq let stale values win. Fixed to structural recency (deeper level =
  older, then seq within level); the oracle sweep now passes across both strategies and
  mid-run switches.
