# Further — compaction-strategies parking lot

Material deliberately cut from `index.mdx` to keep it answering one question (a
compaction strategy chooses which amplification eats your headroom). Several
items were promised by the lsm-tree-compaction parking lot and remain future
pieces of their own.

## Inside a write stall (the back-pressure piece)

The draft renders the stall as a binary stop that drops writes onto a counter.
The real mechanism is a control system: `level0_slowdown_writes_trigger` engages
a write-rate limiter (`delayed_write_rate`, default 16 MB/s, dynamically
adjusted), `level0_stop_writes_trigger` blocks the write path entirely, and
parallel triggers fire on memtable count (`max_write_buffer_number`) and
estimated pending compaction bytes (`soft/hard_pending_compaction_bytes_limit`).
A "why your p99 has a sawtooth" explainer could visualize the limiter chasing
the compaction backlog.

## Universal compaction's actual picking algorithm

The sim merges a whole tier when 4 runs accumulate. Real universal compaction
picks by sorted-run count and _size ratio_ (`size_ratio`, default 1%), prefers
merging young similar runs, and triggers a space-amplification compaction when
estimated garbage exceeds `max_size_amplification_percent` (default 200). The
subtleties (write amplification creep as runs diverge in size, the periodic
full compactions) deserve their own treatment.

## Lazy leveling and hybrid strategies

Research strategies sit between the two corners: Dostoevsky's lazy leveling
(tiered at upper levels, leveled at the bottom), Fluid LSM, and RocksDB's
`level_compaction_dynamic_level_bytes` reshaping. The design space is exactly
the RUM surface; an interactive "drag the knee point" piece would extend FIG. 1
naturally.

## Compaction scheduling and parallelism

One job at a time here. Real engines run `max_background_jobs` compactions with
subcompactions splitting key ranges, and the scheduler must avoid starving L0
(stall risk) while still draining deep levels (space risk). Priority policies
(`kMinOverlappingRatio` etc.) are a scheduling explainer on their own.

## Time-windowed strategies

TWCS got one sentence as the "refuse the trade" option. The interesting parts:
out-of-order writes poisoning windows, TTL-aligned whole-SSTable drops, and why
mixing TWCS with wide reads reintroduces the read amplification it promised to
avoid.

## Remote/disaggregated compaction

Offloading compaction to other machines (RocksDB remote compaction, cloud-native
LSMs) breaks the shared-disk-budget premise of FIG. 1 — the budget becomes a
cluster resource. Pairs with the "where write amplification actually comes from"
piece promised in the lsm-tree-compaction parking lot.

## Bloom filters and the read-amp gap

Carried over from explainer #5's parking lot and still open: with filters, read
amplification decouples from sorted-run count (the sim's deliberate omission).
Tiered + blooms is why production systems tolerate dozens of runs; the
filter-memory-vs-read-IO trade is itself a RUM corner (that is the M).
