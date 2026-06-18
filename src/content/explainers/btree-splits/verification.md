# Verification checklist — btree-splits (explainer #10)

Step 5 verification pass. Claims from prose and the FIG. 01 caption checked against PRIMARY
sources only: the PostgreSQL nbtree source (README, nbtsplitloc.c) and postgresql.org/docs.
The two load-bearing behavioral claims (rightmost→fillfactor split, otherwise 50/50) were
re-fetched from nbtsplitloc.c during this pass and quoted below.

Legend: ✅ verified · ⚠️ simplification (labeled in prose — checked) · ❌ wrong/unverifiable.

Primary sources:

- nbtree README: https://github.com/postgres/postgres/blob/master/src/backend/access/nbtree/README
- nbtsplitloc.c (_bt_findsplitloc): https://github.com/postgres/postgres/blob/master/src/backend/access/nbtree/nbtsplitloc.c
- CREATE INDEX (fillfactor): https://www.postgresql.org/docs/current/sql-createindex.html
- REINDEX: https://www.postgresql.org/docs/current/sql-reindex.html
- pgstattuple: https://www.postgresql.org/docs/current/pgstattuple.html
- Knuth, TAOCP vol. 3 §6.2.4 (random-insertion utilization)

Cross-check method: the sim's split behavior, fill ratios, and split tallies are asserted in
`btreeSim.test.ts` (sequential → 0 interior splits & >80% fill; random → interior splits &
<80% avg fill; lower fillfactor → looser pages; deletes don't merge).

---

## A. Structure and growth

1. **Postgres btree is a B+tree: keys in leaves, internal pages are separators + child
   pointers** ✅ README / btree docs (non-pivot tuples in leaves, pivot tuples route).
2. **A page splits when an insert won't fit; the split pushes a separator up; cascades can
   reach the root, which is the only way the tree gains a level; all leaves stay at equal
   depth** ✅ README (split protocol; tree height grows only via root split). Sim asserts equal
   leaf depth and height = depth+1 after every op.
3. **Real 8 KB pages hold hundreds of entries → 3–4 levels over billions of rows** ✅ general
   btree docs; ⚠️ sim uses 5-key leaves (labeled SIMPLIFICATIONS[0]).

## B. The split-location heuristic (the heart of the piece)

4. **Rightmost-page / ascending inserts split to leave the LEFT page ~fillfactor% full, so
   sequential keys pack to fillfactor instead of 50%** ✅ nbtsplitloc.c header, verbatim: "If
   the page is the rightmost page on its level, we instead try to arrange to leave the left
   split page fillfactor% full. In this way, when we are inserting successively increasing keys
   (consider sequences, timestamps, etc) we will end up with a tree whose pages are about
   fillfactor% full, instead of the 50% full result that we'd get without this special case."
   Sim: `splitLeaf` uses `fillfactor` on a rightmost-append split → asserted 0 interior splits
   for sequential and >80% fill.
5. **Non-rightmost leaf splits aim 50/50** ✅ nbtsplitloc.c verbatim: "Other leaf page. 50:50
   page split." Sim: `splitLeaf` uses `floor(n/2)` otherwise → asserted interior splits for
   random keys.
6. **Random insertion converges on ~69% (ln 2) page utilization** ✅ Knuth TAOCP vol. 3
   §6.2.4 (classic B-tree random-insertion analysis). Sim asserts random avg fill < 80% and <
   sequential; the precise 69% is a real-Postgres claim, not asserted on the 5-key toy (whose
   small capacity makes the constant coarse) — ⚠️ stated in prose as the real-tree limit.
7. **Default btree fillfactor is 90** ✅ CREATE INDEX storage parameters (B-tree fillfactor
   default 90). Sim DEFAULT_FILLFACTOR = 90.

## C. Costs of random keys

8. **Random keys → more leaves, more total splits, more space for the same keys** ✅ follows
   from B4–B6. Sim asserts random splits/insert > sequential and random fill < sequential.
9. **Splits are WAL-logged and dirty pages → full-page images after a checkpoint** ⚠️
   consequence of WAL full-page-write behavior (verified in the WAL explainer); not modeled
   here — labeled SIMPLIFICATIONS[5] and stated as real-Postgres cost.
10. **Rightmost concentration is a single-page hotspot under concurrency** ⚠️ true of the
    L&Y/buffer-locking model (README: page-level locking); the sim is single-threaded —
    SIMPLIFICATIONS[4]. Stated in prose as the tax sequential keys pay.

## D. Deletes and bloat

11. **Underfull pages are never merged; a page is reclaimed only when completely empty, by
    VACUUM** ✅ README verbatim: "We consider deleting an entire page from the btree only when
    it's become completely empty of items. (Merging partly-full pages would allow better space
    reuse, but it seems impractical…)." Sim: a leaf is dropped only at 0 keys; partial pages
    persist (asserted: mass delete leaves leaf count ≈ unchanged, fill < 70%).
12. **REINDEX (CONCURRENTLY since PG 12) rebuilds a densely-packed index** ✅ REINDEX docs.

## E. What real Postgres adds

13. **_bt_findsplitloc evaluates many candidate split points; special handling for rightmost
    and duplicate-heavy pages** ✅ nbtsplitloc.c.
14. **Leaf entries are key + heap TID; deduplication into posting lists since PG 13** ✅ README
    (deduplicate non-pivot tuples into a posting list of heap TIDs).
15. **Bottom-up index deletion (PG 14) clears version-churn dead entries before splitting** ✅
    README (backstop against version-driven page splits, driven by heuristics).
16. **Lehman-Yao B-link tree with right-links; readers descend without blocking on splits** ✅
    README (correct implementation of L&Y; right-link pointer; Postgres adds left links and
    page-level read locking).

## F. Simplifications (confirmed labeled in prose / SIMPLIFICATIONS)

- ⚠️ 5-key leaves / 4-child internals vs hundreds — SIMPLIFICATIONS[0].
- ⚠️ bare keys, no heap TID, no dedup — SIMPLIFICATIONS[1].
- ⚠️ clean fillfactor/50-50 ratios vs full candidate evaluation — SIMPLIFICATIONS[2].
- ⚠️ deletes drop only empty leaves; no bottom-up deletion modeled — SIMPLIFICATIONS[3].
- ⚠️ no concurrency (the hotspot is only about split location here) — SIMPLIFICATIONS[4].
- ⚠️ no WAL / full-page images — SIMPLIFICATIONS[5].

## Open items for human review before flipping draft:false

- [ ] Author reads every sentence and exercises: sequential to height 3, random bloat, the
      fillfactor slider, mass-delete-then-observe-no-shrink, reduced-motion stepped mode, 360px
      width (tree horizontal scroll), button spam, tab backgrounded 30s.
- [ ] Confirm the `/mvcc-bloat` links resolve once both drafts publish.
- [ ] Opening hook now compares UUIDv7 vs UUIDv4 (same 16-byte width) so the size gap is
      purely the ~69% vs ~90% packing difference, not key width. "Roughly a quarter smaller"
      follows from 1 − 69/90 ≈ 0.23; confirm this reads as derived-illustrative, not a measured
      benchmark.
