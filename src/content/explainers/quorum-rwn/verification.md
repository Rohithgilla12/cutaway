# Verification checklist — quorum-rwn (explainer #11)

Step 5 verification pass. Claims from prose and the FIG. 01 caption checked against PRIMARY
sources: the Dynamo paper (SOSP 2007), Kleppmann's DDIA ch. 5, and the Apache Cassandra
architecture docs (re-fetched this pass for the production-system specifics).

Legend: ✅ verified · ⚠️ simplification (labeled in prose — checked) · ❌ wrong/unverifiable.

Primary sources:

- Dynamo paper: https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf
- DDIA ch. 5 (Kleppmann, 2017) — leaderless replication / quorums
- Cassandra dynamo architecture: https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html
- Vogels, "Eventually Consistent" (2008)

Cross-check method: the overlap guarantee, the break, sloppy/hinted-handoff, and read repair
are asserted in `quorumSim.test.ts`. The theorem test is EXHAUSTIVE over all N∈[3,7] and all
(R,W) with R+W>N: after a write, partitioning the entire write set never yields a stale OK read
(only fresh or unavailable) — a machine-checked proof of the pigeonhole claim for the sim's
selection policy.

---

## A. The model

1. **Leaderless replication with N replicas per key, no primary; coordinator writes to W and
   reads from R** ✅ Dynamo §4.5 (N, R, W); DDIA ch. 5 "Leaderless Replication."
2. **Reads return the newest version among responders; replicas version their values** ✅
   Dynamo (data versioning); DDIA (version numbers / "newest wins"). ⚠️ sim uses a single
   monotonic counter rather than vector clocks — SIMPLIFICATIONS[2].
3. **W and R are tunable; W=N or W=1 extremes and their durability/availability trade** ✅
   Dynamo §4.5 ("R and W … the minimum number … usual configuration"); Vogels essay.

## B. The inequality (the core)

4. **A read sees the latest write iff the read set overlaps the write set; R+W>N forces overlap
   by pigeonhole** ✅ Dynamo §4.5 / Vogels: "R + W > N yields a quorum-like system"; DDIA
   states the R+W>N overlap rule explicitly. Sim: exhaustive test confirms no stale OK read is
   constructible when R+W>N.
5. **R+W≤N leaves room for disjoint read/write sets → stale reads possible** ✅ DDIA (if R+W≤N
   "you are more likely to read stale values"); Vogels (R+W≤N → weak/eventual consistency). Sim:
   break test produces a concrete stale read at N=5,W=2,R=2.
6. **N=3, W=2, R=2 is the canonical default (R+W=4>3, tolerates one node down)** ✅ DDIA;
   Cassandra QUORUM at RF=3 is 2. ✅ Cassandra doc: QUORUM = majority (n/2 + 1).

## C. The availability cost (CAP)

7. **R+W>N means a partition that removes the write set can make reads UNAVAILABLE rather than
   stale** ✅ DDIA "Limitations of Quorum Consistency" + CAP framing; the consistency/availability
   trade. Sim: explicit test (N=3,W=2,R=2; partition both write holders → read fails).
8. **Lowering R/W → availability + staleness; raising → consistency + unavailability** ✅ Vogels;
   DDIA. The sim makes both directions reproducible.

## D. Sloppy quorum and hinted handoff

9. **Sloppy quorum: during a partition, write to reachable non-home nodes to still collect W
   acks** ✅ Dynamo §4.6 (sloppy quorum, "always writeable"); DDIA. ⚠️ sim uses a fixed stand-in
   pool rather than walking the ring — SIMPLIFICATIONS[3].
10. **Hinted handoff: stand-in holds a hint and forwards to the rightful replica on recovery** ✅
    Dynamo §4.6; Cassandra doc verbatim ("Hinted handoff in the write path"). Sim: heal delivers
    the hint and clears the stand-in (test "hinted handoff delivers").
11. **Sloppy quorum breaks the R+W>N guarantee (write set no longer a subset of the home N)** ✅
    DDIA explicitly: with a sloppy quorum "there is no guarantee that a read … sees it" until
    handoff completes. Sim: sloppy write parked on a stand-in is invisible to a strict home read
    (test "invisible to a strict read").

## E. Limits and convergence

12. **R+W>N is NOT linearizability (concurrent writes/siblings, partially-failed writes,
    sloppy)** ✅ DDIA "Limitations of Quorum Consistency" enumerates exactly these. Stated in
    prose; sim's verdict label is "overlap-guaranteed", not "linearizable".
13. **Conflicts → vector clocks + application reconciliation (Dynamo) OR last-write-wins on a
    timestamp (Cassandra)** ✅ Dynamo §4.4 (vector clocks, semantic reconciliation); Cassandra
    doc verbatim (last-write-wins, every mutation timestamped). ⚠️ sim has no concurrent-write
    conflict path — SIMPLIFICATIONS[2,4].
14. **Read repair (read path) and anti-entropy via Merkle trees (background)** ✅ Dynamo §4.7
    (anti-entropy, Merkle trees); Cassandra doc ("Replica read repair in the read path"). Sim
    models read repair on responders; ⚠️ no background anti-entropy — SIMPLIFICATIONS[5].

## F. Simplifications (confirmed labeled in prose / SIMPLIFICATIONS)

- ⚠️ one key, no consistent-hashing ring — SIMPLIFICATIONS[0].
- ⚠️ coordinator picks first reachable replicas by index; guarantee is selection-independent —
  SIMPLIFICATIONS[1].
- ⚠️ monotonic version counter, no vector clocks / siblings — SIMPLIFICATIONS[2].
- ⚠️ fixed stand-in pool vs ring walk — SIMPLIFICATIONS[3].
- ⚠️ instantaneous ops, no timeouts / coordinator failure / concurrent-write race —
  SIMPLIFICATIONS[4].
- ⚠️ read repair only on responders, no background anti-entropy — SIMPLIFICATIONS[5].

## Open items for human review before flipping draft:false

- [ ] Author reads every sentence and exercises: the break (R+W≤N stale read), raising R+W>N to
      close it, the availability failure (partition the write set under R+W>N), sloppy + hinted
      handoff round trip, read repair on/off, N/R/W slider clamps, 360px width, button spam.
- [ ] Confirm the `/raft-leader-election` link resolves (it is published, not a draft).
- [ ] DDIA is a book (no URL); confirm the chapter-5 citations read acceptably for the Sources
      section's "primary source" standard.
