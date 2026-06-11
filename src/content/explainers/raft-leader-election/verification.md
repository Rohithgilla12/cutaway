# Verification checklist — raft-leader-election (explainer #2)

Step 5 verification pass. Every checkable technical claim from the prose and component
captions, verified against PRIMARY sources only: the Raft extended paper (raft.github.io/raft.pdf,
§§5.1–5.4), etcd's tuning docs, and the official Consul / CockroachDB docs for the "uses Raft"
claims. Blog/SO answers are not verification sources.

Legend: ✅ verified (source + confirming sentence) · ⚠️ simplification (must be labeled in
prose — checked it IS) · ❌ wrong/unverifiable (fixed or cut).

Primary sources used:

- Raft extended paper (pages 5–9 = §§5.1–5.4.3): https://raft.github.io/raft.pdf
- etcd tuning: https://etcd.io/docs/v3.5/tuning/
- Consul consensus: https://developer.hashicorp.com/consul/docs/architecture/consensus
- CockroachDB replication layer: https://www.cockroachlabs.com/docs/stable/architecture/replication-layer

Cross-check method: the three coached experiments and the Split 2/3 caption were executed
against the actual sim core (seed `0xdeadbeef`) via a throwaway vitest harness. Trajectory
results are quoted under section H.

---

## A. The term as logical clock (§5.1)

1. **"Every leadership attempt happens in a numbered term, and terms only ever increase."**
   ✅ §5.1: "Terms are numbered with consecutive integers." / "Each server stores a current
   term number, which increases monotonically over time."

2. **"the moment it sees a message carrying a term higher than its own, it … reverts to
   follower."** (step-down rule)
   ✅ §5.1: "if one server's current term is smaller than the other's, then it updates its
   current term to the larger value. If a candidate or leader discovers that its term is out
   of date, it immediately reverts to follower state." Matches sim `stepDown`.

3. **"Terms are not wall-clock time; they are an ever-rising sequence number that lets any two
   nodes compare 'who is more current' without a shared clock."**
   ✅ §5.1: "Terms act as a logical clock [14] in Raft, and they allow servers to detect
   obsolete information such as stale leaders."

## B. Election driven by randomized timeouts (§5.2)

4. **"Each follower runs an election timer; if it fires before a heartbeat resets it, the
   follower increments its term, becomes a candidate, votes for itself, and asks every peer
   for a vote."**
   ✅ §5.2: "To begin an election, a follower increments its current term and transitions to
   candidate state. It then votes for itself and issues RequestVote RPCs in parallel to each
   of the other servers." Reset-on-heartbeat: "A server remains in follower state as long as
   it receives valid RPCs from a leader or candidate." Matches sim `advanceTimers` /
   `becomeCandidate`.

5. **"The randomization … is what keeps the nodes from all timing out at once and splitting
   the vote."**
   ✅ §5.2: "Raft uses randomized election timeouts to ensure that split votes are rare … To
   prevent split votes in the first place, election timeouts are chosen randomly from a fixed
   interval." Matches sim `randTimeout`.

6. **"a leader shows no arc because it heartbeats instead of timing out."** (viz caption)
   ✅ Matches sim: a leader's `electionElapsedMs` is held at 0 (`advanceTimers`), and
   `timerPct` is 0 for `role === "leader"` in `snapshotImpl`. ClusterGraph draws no
   `TimerArc` for leader/dead. Consistent.

## C. The single persisted vote + majority (§5.2, Election Safety)

7. **"Each node grants at most one vote per term."**
   ✅ §5.2: "Each server will vote for at most one candidate in a given term, on a
   first-come-first-served basis." Matches sim `handleRequestVote` (`votedFor === null ||
votedFor === candidate`).

8. **"that grant is persisted before the reply is sent."**
   ⚠️ §5 (Figure 2) lists `votedFor` as persistent state updated on stable storage before
   responding to RPCs. The sim updates `votedFor` synchronously and skips the disk write —
   labeled in the blockquote at line 48 ("A real deployment fsyncs those three fields before
   replying to a vote; the sim updates them synchronously and skips modeling the disk write")
   and SIMPLIFICATIONS[3]. Correctly labeled in place.

9. **"a candidate must collect a strict majority — three of five."**
   ✅ §5.2: "A candidate wins an election if it receives votes from a majority of the servers
   in the full cluster for the same term." Sim `QUORUM = 3`, `NODE_COUNT = 5`.

10. **"Any two majorities of a five-node cluster share at least one node, and that shared node
    will not vote for two different candidates in the same term. So two candidates cannot both
    reach three votes in term N. At most one leader per term."** (quorum-intersection argument)
    ✅ §5.2: "The majority rule ensures that at most one candidate can win the election for a
    particular term (the Election Safety Property of Figure 3)." Figure 3: "Election Safety:
    at most one leader can be elected in a given term. §5.2." This is the sim's tested
    invariant (raftSim.test.ts).

## D. Persistent vs volatile state across restart (§5.1 / Figure 2)

11. **Blockquote: "The sim persists `term`, `votedFor`, and the `log` across a node restart …
    and resets only volatile state, matching Raft's split of persistent versus volatile state
    in §5."**
    ✅ §5 Figure 2 names `currentTerm`, `votedFor`, `log[]` persistent; `commitIndex`,
    `nextIndex[]`, `matchIndex[]` volatile. Matches sim `restartNode` (retains term/votedFor/
    log; resets role, commitIndex, nextIndex, matchIndex). ⚠️ disk-write omission labeled (see #8).

## E. The three coached experiments (prose ↔ sim, executed)

12. **Experiment 1 — "Kill the leader … one node reaches its threshold first, bumps the term,
    and requests votes before the others wake up. It collects three of the four survivors and
    the election log shows a single clean term increment."**
    ✅ Executed (seed): killing the first leader (n1) produces a single new leader (n3) after
    ~2100 ms, electionCount goes 1→2 (one clean increment). Matches sim and §5.2.

13. **Experiment 1 timing — "the gap is roughly one election timeout — here scaled to the
    1.5–3 s human-watchable range."**
    ✅ `ELECTION_TIMEOUT_MIN_MS = 1500`, `ELECTION_TIMEOUT_MAX_MS = 3000`. Measured gap
    2100 ms falls inside. Exact match to exported constants.

14. **Experiment 2 — "press Isolate leader … The old leader is now alone in term N. It does
    not step down … The four reachable nodes time out and elect a new leader in term N+1 …
    Both wear the L glyph."**
    ✅ Executed (seed): isolating leader n1 (term 1) yields two leaders — n1(term 1) and
    n3(term 2). Matches §5.1 (no higher-term message reaches n1, so it never steps down) and
    the split-brain annotation in RaftViz (`splitBrainAnnotation`). Both render the "L" glyph
    (`roleGlyph`).

15. **Experiment 2 annotation — "the stale minority leader at the lower term that cannot
    commit, and the real majority leader at the higher term."**
    ✅ Matches `splitBrainAnnotation`: it names the lower-term leader "minority, cannot commit"
    vs the higher-term leader. Consistent.

16. **Experiment 3 — "press Client write a few times. The entries append to the stale
    leader's log — its `log` count climbs … but its `commit` counter does not move."**
    ✅ Executed (seed): while n1 is isolated, clientWrite appends to n1 (log climbs) but
    commitIndex stays 0. Matches sim `clientWrite` (write goes to every node that believes it
    is leader) + `maybeAdvanceCommit` (needs QUORUM replicas, unreachable for an isolated leader).

17. **Experiment 3 — "the isolated leader can reach exactly one node: itself."**
    ✅ Follows from `handleIsolateLeader` cutting all of the leader's links, and
    `advanceMessages` dropping traffic on down links. Consistent.

18. **Experiment 3 — "press Heal all. The stale leader receives a heartbeat stamped with term
    N+1, sees a term higher than its own, and steps down to follower … Its uncommitted entries
    … are overwritten by the real leader's log. No acknowledged write is lost."**
    ✅ Executed (seed): after Heal all, n1 → role follower, term 2, and its previously
    uncommitted entry is replaced; commit advances to the real leader's committed prefix.
    Matches §5.1 (step-down) + §5.3 (`handleAppendEntries` conflict truncation). No write was
    ever acknowledged committed, so none is lost — matches the sim semantics and the article's
    opening claim.

## F. Failure modes

19. **Split votes — "If two followers time out close together, each can win a couple of votes
    and neither reaches three; the term ends with no leader and everyone tries again."**
    ✅ §5.2: "votes could be split so that no candidate obtains a majority … each candidate
    will time out and start a new election by incrementing its term." Matches sim
    (`becomeCandidate` re-runs on the next timeout; electionCount climbs with no `elected` line).

20. **The up-to-date rule (§5.4.1) — "a voter refuses any candidate whose log is less
    up-to-date than its own, judged by last-log-term first, then last-log-index."**
    ✅ §5.4.1: "If the logs have last entries with different terms, then the log with the later
    term is more up-to-date. If the logs end with the same term, then whichever log is longer
    is more up-to-date." (term first, then length = index). Matches sim `candidateLogUpToDate`
    exactly. Section number §5.4.1 confirmed.

21. **§5.4.1 — "a node missing committed entries must never win, or it would erase them."**
    ✅ §5.4: "a follower might be unavailable while the leader commits several log entries,
    then it could be elected leader and overwrite these entries with new ones." §5.4.1: the
    restriction ensures "the leader for any given term contains all of the entries committed
    in previous terms (the Leader Completeness Property)."

22. **§5.4.1 staging experiment — "Cut one node off before issuing some client writes, so it
    misses them; heal it; then kill the leader … the nodes that hold the newer entries will
    refuse it … It cannot win despite being alive and willing."**
    ✅ Executed (seed): starved node n0 (log 0 while leader log 3), healed, then killed the
    leader → new leader is n3 (log 3); `victim_won = false`. The stale node could not win.
    The control names match (click a node's links to cut/heal; Kill button on the leader).
    The prose hedges "may fire first," which is honest about the timer race.

23. **2/5 partition can never elect — "Two nodes cannot reach three votes no matter how long
    they try, even among themselves, because the third vote physically lives on the other side
    of the partition. A minority partition is permanently leaderless by construction."**
    ✅ Direct corollary of the majority rule (§5.2) + quorum intersection. Confirmed in the
    Split 2/3 trace: the minority leader n1 never advances commit and never gains a third vote.

24. **"five nodes tolerate two failures, four nodes also tolerate only one, so the odd count
    is not an accident."**
    ✅ §5.1: "five is a typical number, which allows the system to tolerate two failures."
    Arithmetic: 4-node majority = 3, so a 4-node cluster tolerates 1 failure (same as 3-node),
    confirming the odd-count point. Correct.

## G. Production grounding and cited numbers

25. **"etcd defaults the heartbeat interval to 100 ms and the election timeout to 1000 ms — a
    10:1 ratio."**
    ✅ etcd tuning: "By default, etcd uses a 100ms heartbeat interval." / "By default, etcd
    uses a 1000ms election timeout." 1000/100 = 10:1. Exact.

26. **"the election timeout … needs to be at least ten times the round-trip time between
    members."**
    ✅ etcd tuning: "Election timeouts must be at least 10 times the round-trip time so it can
    account for variance in the network." Exact.

27. **"it permits values up to 50000 ms for globally distributed clusters."**
    ✅ etcd tuning: "The upper limit of election timeout is 50000ms (50s), which should only be
    used when deploying a globally-distributed etcd cluster." Exact.

28. **"The Raft paper's own recommendation is tighter, an election timeout in the 150–300 ms
    range (§5.2)."**
    ✅ §5.2: "election timeouts are chosen randomly from a fixed interval (e.g., 150–300ms)."
    Section §5.2 and range confirmed.

29. **"The sim scales both up by roughly an order of magnitude — 1.5–3 s election timeouts,
    500 ms heartbeats."**
    ⚠️ Exact vs the paper (150–300ms → 1500–3000ms is precisely 10×). Looser vs etcd
    (100ms → 500ms is 5×). The "roughly an order of magnitude" framing is anchored to "so the
    dynamics are watchable" and matches the paper's range exactly; acceptable as labeled
    rounding, not an error. Sim constants confirmed: `HEARTBEAT_INTERVAL_MS = 500`,
    `ELECTION_TIMEOUT_MIN_MS = 1500`, `ELECTION_TIMEOUT_MAX_MS = 3000`.

30. **"Raft is … the consensus layer under etcd (and therefore Kubernetes), Consul, and
    CockroachDB's per-range replication."**
    ✅ etcd: the cited etcd tuning page is etcd's own Raft tuning doc (etcd's consensus is
    Raft); Kubernetes uses etcd as its backing store (well-established, etcd is the K8s
    datastore). Consul: "Raft is a consensus algorithm that Consul implements to manage
    distributed datacenter operations." CockroachDB: "Raft organizes all nodes that contain a
    replica of a range into a group — unsurprisingly called a Raft group" (per-range).
    All three confirmed against official docs.

## H. The §5.4.2 / Figure 8 commit rule

31. **"A leader … may only count replicas for entries from its own current term, and
    prior-term entries commit indirectly, carried along once a current-term entry above them
    commits (§5.4.2)."**
    ✅ §5.4.2: "Only log entries from the leader's current term are committed by counting
    replicas; once an entry from the current term has been committed in this way, then all
    prior entries are committed indirectly because of the Log Matching Property." Section
    §5.4.2 confirmed. Matches sim `maybeAdvanceCommit` (`if (termAt(n, idx) !== n.currentTerm)
continue;`).

32. **"The reason is Figure 8 of the paper: a leader that committed a prior-term entry by
    replica count could later see that same entry overwritten by a different leader, which
    would mean committing and then losing the same entry."**
    ✅ §5.4.2 + Figure 8 caption: "the log entry from term 2 has been replicated on a majority
    of the servers, but it is not committed. If S1 crashes as in (d), S5 could be elected
    leader … and overwrite the entry with its own entry from term 3." The article's
    description is a faithful summary; the full walk-through correctly lives in further.md
    (one-question discipline preserved).

33. **One-question discipline — Figure 8 parked, not expanded.**
    ✅ Prose: "the full walk-through of Figure 8 lives in this explainer's parking-lot notes
    rather than here, because it is a log-replication subtlety, not an election one." further.md
    contains the full §5.4.2 walk-through. Adjacent depth gets one sentence + parking lot, per
    the voice rule.

## I. Other sim-fidelity simplification labels

34. **Blockquote: "The sim sends the entire log suffix after prevLogIndex in each
    AppendEntries, and a follower that rejects backs the leader off one index per round. Real
    implementations batch and cap entries per RPC and use the conflict-term optimization from
    §5.3."**
    ✅ Matches SIMPLIFICATIONS[6] (entire suffix) and SIMPLIFICATIONS[7] (no conflictTerm/
    conflictIndex; back off one index). §5.3 conflict-term optimization confirmed in the paper
    ("the follower can include the term of the conflicting entry and the first index it stores
    for that term … one AppendEntries RPC will be required for each term with conflicting
    entries"). Correctly labeled in place.

---

## Cross-check note: the Split 2/3 caption is seed-dependent (verified, not an error)

Figure-1 caption: "Press Split 2/3 to partition the cluster … Watch the isolated leader's
commit counter refuse to move while the majority side elects around it." This presupposes the
leader is in the minority {0,1} group. On first load with seed `0xdeadbeef` the first leader is
**n1**, which is in {0,1}, so the partition does isolate the leader and the caption holds (trace:
n1 stuck at commit 0, n3 elected term 2, commit 3). If the reader has already triggered elections
that move leadership to {2,3,4}, Split 2/3 keeps that leader and no split-brain appears. The
caption describes the default-seed first interaction, which is the state the figure renders, so
it is accurate as written. No fix required; recorded here so a future seed change re-checks it.

---

## Result tally

- ✅ verified: 29
- ⚠️ simplifications (all confirmed labeled in place): 4 (claims 8/11 disk-write omission;
  29 timing-scale rounding) — counted within the 34 as verified-and-labeled.
- ❌ wrong → fixed: 0 technical claims. See "Corrections applied" below for prose/voice.
- cut: 0.

## Corrections applied (Part A/B fixes)

No ❌ technical claims were found. Every protocol statement, section number (§5.1, §5.2,
§5.4.1, §5.4.2), cited constant (etcd 100/1000 ms, 10×, 50000 ms ceiling; paper 150–300 ms;
sim 500 ms / 1.5–3 s), and named-system claim (etcd→Kubernetes, Consul, CockroachDB per-range)
matched its primary source. The two highest-risk claims — the election-restriction comparison
order (last-log-term first, then index) and the §5.4.2 current-term-only commit rule — are
stated exactly as the paper draws them and are implemented faithfully in the sim.

Banned-phrase scan: clean (no "simply" / "just" minimizers, no "delve" / "leverage" /
"magic" / "dive in", no exclamation marks, no 3+ em-dash filler chains; the paired em-dashes
are parenthetical asides). Word count ≈ 2,235 (within 1,500–3,000). Hook is a concrete outage
scenario, not a definition. One-question discipline held (Figure 8 parked to further.md).
Sources section present and honest.

## No-touch code observations (report only — sim/viz not modified)

- None blocking. The sim, viz, and controls match the prose as written. The only fragility is
  the seed-dependent Split 2/3 caption documented above; it is correct for the shipped seed.

## Edge-state QA (2026-06-11)

Exercised in a real browser (built site, Playwright): election fires once the figure scrolls into view (offscreen rAF
pause works as designed); Isolate leader produced the two-leaders state (n1 term 1 minority vs n3 term 2, 3/5 votes)
with the persistent annotation; Heal all produced "n1 sees term 2, steps down"; link cut/heal buttons are
keyboard-reachable with aria-labels; 360px layout wraps cleanly after a NodePanel flex-wrap fix (commit counter was
clipped — fixed during QA); zero console errors/warnings. Stepped reduced-motion mode and spam safety covered by code
review + 17 sim invariant tests.
