# Further — lsm-tree-compaction parking lot

Material deliberately cut from `index.mdx` to keep it answering one question
("why LSM trees write fast and read later, and what compaction debt costs you").
Each item is a sentence in the draft at most; several are their own future
explainers. The open question the draft ends on — how to balance the
write/read/space costs of a workload via compaction strategy — lives mostly
here.

## The compaction-strategy question (the draft's one open question)

The draft poses but does not answer: given a workload, how do you trade write,
read, and space amplification against each other? The answer is "pick a
compaction strategy and tune it," and that is a whole explainer with its own
interaction (a slider between write-optimized and read-optimized that moves all
three meters at once).

- **Leveled vs universal (tiered), in depth.** The draft gives each one
  sentence. Leveled keeps every level a single non-overlapping sorted run, pays
  high write amplification, holds read and space amplification low. Universal
  (size-tiered, RocksDB's `kCompactionStyleUniversal`; Cassandra's STCS) waits
  for several similarly-sized runs and merges them, cutting write amplification
  but raising read and space amplification. The RAUM/RUM-conjecture framing
  (read, update, memory — pick a position on the surface, you cannot optimize
  all three) is the proper lens and a clean standalone piece.
- **Partitioned indexes / two-level index blocks.** An SSTable's index can
  itself be too large to hold resident. RocksDB's partitioned index/filter
  feature splits the index and filter blocks into partitions loaded on demand,
  so a point lookup pulls only the relevant partition. Out of scope: the draft
  treats an SSTable as a flat sorted run with no index-block structure (labeled
  in SIMPLIFICATIONS).
- **Blob storage / key-value separation (WiscKey, RocksDB BlobDB).** Large
  values dominate compaction rewrite cost because compaction rewrites the value
  bytes every time it touches the key. WiscKey-style designs store values in a
  separate log and keep only key→offset pointers in the LSM tree, so compaction
  rewrites pointers, not payloads — a large cut to write amplification for
  large-value workloads. Its own topic; the sim stores fixed-size entries with
  no key/value split.

## Cut to protect the single-question rule

- **The full level cascade (L0..L6).** The sim is two levels; real engines stack
  seven with a ~10× size ratio (`max_bytes_for_level_multiplier`) so compaction
  cascades L0→L1→…→L6, each level ~10× the one above. The dynamics of a cascade
  (where bytes spend most of their rewrite budget — the lower, larger levels) is
  a "where write amplification actually comes from" piece.
- **Bloom filters, in depth.** The draft explains _that_ they cut read
  amplification below file count (~10 bits/key, ~1% FP). Not covered: the math of
  bits-per-key vs FP rate, why ~10 bits is the knee of the curve, whole-key vs
  prefix blooms, and ribbon filters as the modern lower-overhead replacement.
  The sim omits blooms entirely so file pile-up is visible as read amplification.
- **Write stalls and back-pressure.** Real engines have
  `level0_slowdown_writes_trigger` and `level0_stop_writes_trigger`: when L0
  grows past these, the engine throttles or halts writes to let compaction catch
  up. The draft's "compaction debt" framing is exactly this back-pressure, but
  the sim lets L0 grow unbounded with no stall — so the reader sees the read-amp
  cost but never the write-stall cost. A "why your writes suddenly stalled" piece.

## Tombstone depth beyond the draft

- **Range tombstones / range deletes.** The draft only models point tombstones
  (one marker per key). Deleting a key range with point tombstones is O(range);
  real engines have range-delete tombstones (RocksDB `DeleteRange`) that mark a
  whole `[start, end)` span dead in one record, with their own compaction and
  read-path handling.
- **Tombstone garbage-collection hazards.** The sim drops a tombstone the moment
  it reaches L1 (bottommost). Real engines may only drop it when no live snapshot
  could still need the shadowed key, which means a long-lived snapshot or a slow
  bottommost compaction can keep tombstones (and the dead data they shadow) alive
  far longer than expected — the classic "my deletes aren't reclaiming space"
  operational surprise.

## Durability — the WAL half of the story

The sim has no write-ahead log: an unflushed memtable would vanish on a crash.
Real engines log every memtable mutation to a WAL first and replay it on
restart to rebuild the memtable. That is the durability half of LSM storage and
it is told in full in explainer #1 (WAL crash recovery); cross-linked from the
draft rather than re-explained here.

## MVCC and sequence numbers

The draft resolves newest-version-wins purely by structure recency (memtable >
newer L0 > older L0 > L1). Real engines stamp every entry with a monotonic
sequence number and resolve versions (and snapshot reads) by sequence, which is
also what makes correct tombstone GC depend on the oldest live snapshot. MVCC is
its own explainer (#?); the sequence-number machinery is noted in SIMPLIFICATIONS.

## Sim fidelity notes (for a future v2 of the component)

- Add bloom filters as a toggle, so the reader can watch read amplification drop
  from "every overlapping file" to "the few that pass the filter" — directly
  demonstrating the draft's bloom paragraph.
- Add L2 (a third level) so the size-ratio cascade and multi-level compaction
  are visible rather than asserted.
- Add a write-stall state when L0 exceeds a stop trigger, so the back-pressure
  cost of unpaid compaction debt is visible alongside the read-amp cost.
- Model overlapping-subset compaction (pick only the L1 files the L0 span
  touches) instead of always folding in all of L1, to match real leveled file
  selection rather than re-partitioning the whole level.
