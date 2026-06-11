# Further — Raft leader election parking lot

Material deliberately cut from `index.mdx` to keep it to one question (leader election + the safety story). Most of this is log-replication depth; each item is a candidate for a future explainer or a footnote if the piece ever expands.

## Figure 8 and the §5.4.2 commit rule (full walk-through)

The article states the rule in one paragraph: a leader may only commit entries from its current term by counting replicas; prior-term entries commit indirectly once a current-term entry above them commits. The reason it exists is worth the full sequence from Figure 8 of the paper.

The hazard: an entry can be stored on a majority of servers and still later be overwritten by a future leader. The paper's scenario, term by term:

1. S1 is leader in term 2, replicates an entry at index 2 to S2, then crashes.
2. S5 wins term 3 (votes from S3, S4, itself — its log is empty at index 2, but the up-to-date rule only compares last-log term/index, and at this moment the candidates are comparable) and accepts a different entry at index 2, then crashes.
3. S1 restarts, wins term 4, and replicates its term-2 entry at index 2 to a majority (S1, S2, S3). The entry from term 2 is now on three of five servers. If the leader were allowed to commit it on replica count alone, it would be committed here.
4. S1 crashes. S5 wins term 5 (votes from S2, S3, S4 — S5's log has a higher last-log term, so it is "more up-to-date" by the rule) and forces its own index-2 entry onto everyone, overwriting the term-2 entry that step 3 had replicated to a majority.

If step 3 had committed that entry, step 4 would overwrite a committed entry — the exact violation the protocol forbids. The fix: in step 3 the leader is in term 4, and the entry it is replicating is from term 2, so it is *not* allowed to count replicas for it. It may only commit it once it also replicates a term-4 entry above it to a majority; doing so makes S5 un-electable (S5's log would no longer be as up-to-date), closing the hole.

The sim encodes exactly this in `maybeAdvanceCommit`: the loop `continue`s past any entry whose `termAt(n, idx) !== n.currentTerm`, so a leader never advances commit onto a prior-term entry directly. Worth a standalone "why distributed commit is more than counting acks" explainer with its own interaction that lets the reader try to commit a prior-term entry and watch it get overwritten.

## Log replication mechanics beyond what election needs

The article only needs replication insofar as the commit index proves a stale leader can't commit. The full replication machinery is its own topic:

- **The consistency check (§5.3).** AppendEntries carries `prevLogIndex`/`prevLogTerm`; a follower rejects unless its log matches at that point. This is what guarantees the Log Matching Property: if two logs contain an entry with the same index and term, they are identical up to that point.
- **Conflict resolution and `nextIndex` back-off.** On rejection the leader decrements `nextIndex` and retries. The sim backs off one index per round (slow, simple). Real Raft uses the `conflictTerm`/`conflictIndex` optimization to skip an entire conflicting term in one round.
- **`matchIndex` vs `nextIndex`.** The leader's two per-follower indices: `nextIndex` is optimistic (where to try sending next), `matchIndex` is proven (highest index known replicated). Commit advancement counts `matchIndex`.

## Cluster membership changes (joint consensus, §6)

The sim fixes the node set at five. Real clusters add and remove members without downtime, and doing it safely is non-trivial: a naive switch can create two disjoint majorities (old config vs new config) that each elect a leader. Raft's answer is joint consensus — a transitional configuration that requires majorities of *both* the old and new sets — or the simpler single-server-at-a-time approach used in practice. This is a whole explainer on its own; the failure mode (split brain via reconfiguration) is a clean "break it" interaction.

## Log compaction and snapshotting (§7)

The sim's log grows unbounded and recovery always replays from index 0. Real systems snapshot state and discard the prefix, which introduces `InstallSnapshot` RPC for followers that have fallen behind the leader's snapshot point. Out of scope here; relevant to a storage/recovery explainer.

## Read paths and linearizability

The sim has no read path — `clientWrite` is the only client operation. Real systems must answer reads without serving stale data from a deposed leader: ReadIndex (confirm leadership via a heartbeat round before serving), lease-based reads (serve locally within a bounded clock lease), or routing reads through the log. The stale-leader-serving-stale-reads failure is exactly the kind of thing this site likes; candidate for a "linearizable reads are harder than writes" piece.

## Pre-vote and the disruptive-server problem

A node partitioned away and rejoining will have bumped its term repeatedly while isolated; on rejoin its high term forces the healthy leader to step down even though nothing was wrong. The Pre-Vote extension (a candidate first checks whether it *could* win before incrementing its term) prevents this. The sim does not model Pre-Vote, so an isolated node that you heal does briefly disrupt the cluster — visible if you isolate a follower for a while, then heal.

## etcd / Consul / CockroachDB specifics not in the article

- etcd exposes `--heartbeat-interval` and `--election-timeout` directly; the 10:1 default ratio and the ≥10×-RTT guidance are operational folklore worth a sidebar.
- CockroachDB runs one Raft group per range (not one per cluster), so a single node participates in thousands of Raft groups; it uses a shared heartbeat ("coalesced heartbeats") to avoid N× the heartbeat traffic. Good material for a "Raft at scale" piece.
- Consul layers Serf/gossip for membership and failure detection underneath Raft, separating "who is in the cluster" from "who is the leader."
