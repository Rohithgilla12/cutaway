# Further — quorum-rwn parking lot

Material deliberately cut from `index.mdx` to keep it answering one question (what R+W>N
guarantees, and where it stops). Each is a sentence in the draft at most; several are their own
explainers.

## Vector clocks and sibling reconciliation

The draft names vector clocks in one breath. The full mechanism — how a vector clock captures
causality, how a coordinator detects that two versions are concurrent (neither descends from
the other), how Dynamo returns siblings to the client and the shopping-cart "merge by union"
reconciliation, and why clock truncation is needed in practice — is a whole "how a leaderless
store knows two writes conflict" explainer with a great interaction (issue concurrent writes,
watch siblings appear, merge them).

## Last-write-wins and its data-loss footgun

Cassandra's default LWW silently drops one of two concurrent writes by timestamp, and clock skew
makes "last" a lie. The failure mode (a write that returned success vanishing because another
node's clock was ahead) and the mitigations (NTP discipline, monotonic timestamps, avoiding LWW
for non-commutative data) is a pointed standalone piece.

## Consistent hashing and the preference list

The sim flattens the ring to one key on N fixed replicas. The real structure — the hash ring,
virtual nodes for load balancing, the preference list as the N nodes following a key's hash, and
how sloppy quorum walks *past* the preferred nodes to the next healthy ones — is its own
explainer (and the reason a partition affects different keys differently).

## Anti-entropy and Merkle trees

Read repair fixes only what reads touch; the draft mentions anti-entropy in one line. How
replicas compare state efficiently with Merkle trees (exchange root hashes, descend only into
differing subtrees), the cost/staleness trade of repair frequency, and the "cold data that no
read ever touches drifts forever without it" failure — a background-convergence piece.

## CRDTs as the other answer to concurrent writes

Conflict-free replicated data types make merge automatic and deterministic (counters, sets,
registers), sidestepping siblings and LWW entirely. Where they fit relative to quorum stores and
their cost (metadata growth, restricted operations) is an adjacent explainer.

## Leaderless vs leader-based, and when to use which

The draft points at Raft/single-leader for linearizability. The full comparison — leaderless
(Dynamo) vs single-leader (Postgres, Raft-backed) vs multi-leader, and which consistency and
availability properties each buys — is a map worth drawing on its own. The "quorum is a knob,
consensus is a guarantee" distinction is the spine of it.

## Probabilistically Bounded Staleness

Even at R+W≤N, reads aren't *usually* stale — PBS (Bailis et al.) quantifies how stale, how
often, as a function of R, W, and replica latencies. A "your eventually-consistent store is more
consistent than the worst case suggests" explainer with a real measurement angle.
