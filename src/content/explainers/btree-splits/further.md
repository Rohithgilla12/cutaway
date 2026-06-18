# Further — btree-splits parking lot

Material deliberately cut from `index.mdx` to keep it answering one question (how page
splits work and why insertion order decides a B-tree's density). Each is a sentence in the
draft at most; several are their own explainers.

## The Lehman-Yao concurrency protocol

The draft mentions right-links and "readers descend without blocking" in one breath. The full
story — the right-link that lets a reader who lands on a just-split page "move right" to find
its key, the page-level locking Postgres adds over L&Y's lock-free reads, the
latch-coupling-free descent, and how a split is made crash-safe (the incomplete-split flag and
how the next inserter finishes it) — is a whole "how a B-tree stays correct under concurrent
splits" explainer. The sim is single-threaded and omits all of it.

## Deduplication and posting lists (PG 13)

One sentence in the draft. The mechanism — merging duplicate index tuples into a single tuple
with a posting list of heap TIDs, the deduplication pass triggered before a split, when it
helps (low-cardinality indexes, version churn) and when it's disabled — deserves its own piece
with an interaction that toggles dedup and watches splits on a low-cardinality column.

## Bottom-up index deletion (PG 14)

The draft names it as a backstop against version-driven splits. The full heuristic — how an
about-to-split leaf page checks whether its bloat is dead version churn (by consulting the
heap) and clears it instead of splitting, and why this dramatically slows index growth on
update-heavy tables — pairs naturally with the MVCC/HOT material and is a strong standalone.

## Index-only scans and the visibility map

Why a B-tree leaf storing the heap TID still needs a heap visit (visibility), and how the
visibility map enables index-only scans that skip it. Adjacent to this piece's "leaves store
key + TID" note; its own topic.

## Other index types as different answers

GIN (inverted, for arrays/jsonb/full-text), GiST (balanced tree for ranges/geometry, with a
penalty-based split that has nothing to do with key order), BRIN (block-range summaries that
exploit physical correlation — the structure that *loves* the sequential ordering this piece
prefers, and is useless without it), and hash. A "choosing an index type" comparison is a
separate explainer; this one is btree only.

## REINDEX, CIC, and build-time packing

The draft says REINDEX rebuilds densely. The depth — why a fresh build packs to fillfactor
bottom-up rather than via splits, REINDEX CONCURRENTLY's lock/rebuild dance, and CREATE INDEX
CONCURRENTLY's two-scan protocol — is an operational "rebuilding indexes without downtime"
piece.

## Measuring real bloat

`pgstattuple` / `pgstatindex` (`avg_leaf_density`, `leaf_fragmentation`) and how to tell
version-churn bloat from delete bloat from the merely-loose packing of random keys. A practical
"is this index actually bloated" diagnostic piece.
