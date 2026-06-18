# Verification checklist — xid-wraparound (explainer #9)

Step 5 verification pass. Every checkable claim from the prose and the FIG. 01 caption,
verified against PRIMARY sources only: postgresql.org/docs/current. The key threshold numbers
were re-fetched from the routine-vacuuming page during this pass (see method).

Legend: ✅ verified · ⚠️ simplification (labeled in prose — checked it IS) · ❌ wrong/unverifiable.

Primary sources:

- PG Routine Vacuuming (wraparound section): https://www.postgresql.org/docs/current/routine-vacuuming.html
- PG VACUUM resource config (freeze ages): https://www.postgresql.org/docs/current/runtime-config-resource.html
- PG Client config (idle_in_transaction_session_timeout): https://www.postgresql.org/docs/current/runtime-config-client.html
- PG Transactions and Identifiers: https://www.postgresql.org/docs/current/transaction-id.html
- PG Page Layout: https://www.postgresql.org/docs/current/storage-page-layout.html
- PG Monitoring Stats: https://www.postgresql.org/docs/current/monitoring-stats.html

Cross-check method: the sim's threshold constants (FREEZE_MAX_AGE=200, WARN_REMAINING=40,
REFUSE_REMAINING=3, WRAP_SPACE=2147, FREEZE_MIN_AGE=50) and the refusal error string were
checked against a live fetch of routine-vacuuming during this pass; all matched. Behavioral
claims are asserted in `wraparoundSim.test.ts`.

---

## A. The 32-bit circle

1. **Xids are 32-bit; ~4 billion distinct values; a busy DB burns through them in days–weeks**
   ✅ routine-vacuuming: "a cluster that runs for a long time (more than 4 billion transactions)
   would suffer transaction ID wraparound."
2. **Comparison is modular; ~2^31 (≈2.1 billion) in the past and ~2.1 billion in the future**
   ✅ routine-vacuuming: normal xids are compared "using modulo-2^32 arithmetic … two billion
   transactions … in the 'future' … two billion … in the 'past'."
3. **A too-old tuple flips from visible-to-all to invisible-to-all (the data loss)** ✅
   routine-vacuuming describes exactly this as the consequence wraparound would cause.
4. **Xids assigned only to writing transactions** ✅ transaction-id (read-only transactions use
   virtual xids); consistent with the MVCC explainer's verified claim.

## B. Freezing and relfrozenxid

5. **Freezing marks a tuple committed-in-the-infinite-past, visible to all regardless of xid**
   ✅ routine-vacuuming: frozen rows are treated as "in the past" to all transactions.
6. **relfrozenxid = oldest unfrozen xid in the table; datfrozenxid per database; cluster
   exposure = min** ✅ routine-vacuuming and pg_class/pg_database column docs.
7. **vacuum_freeze_min_age default 50 million (don't freeze very recent tuples)** ✅
   runtime-config-resource: `vacuum_freeze_min_age` default 50000000. Matches sim FREEZE_MIN_AGE.
8. **Freezing cannot advance past the oldest xmin a snapshot needs (the horizon clamp)** ✅
   routine-vacuuming + MVCC removal-horizon semantics: vacuum's freeze cutoff is bounded by the
   oldest xmin; a long-running transaction holds it back. This is the load-bearing mechanism and
   the same one verified in the MVCC explainer (ComputeXidHorizons).

## C. The thresholds (re-fetched verbatim this pass)

9. **force at autovacuum_freeze_max_age = 200 million, launching an anti-wraparound autovacuum
   even when autovacuum is disabled** ✅ routine-vacuuming: default "200 million transactions";
   and "autovacuum is invoked … even when autovacuum is otherwise disabled" for wraparound.
10. **warnings begin forty million transactions from the wraparound point** ✅ routine-vacuuming
    verbatim: "when the database's oldest XIDs reach forty million transactions from the
    wraparound point." Matches sim WARN_REMAINING=40.
11. **refuses new XIDs under three million transactions remaining** ✅ routine-vacuuming: "refuse
    to assign new XIDs once there are fewer than three million transactions left until
    wraparound." Matches sim REFUSE_REMAINING=3.
12. **Exact error: `database is not accepting commands that assign new XIDs to avoid wraparound
    data loss`** ✅ routine-vacuuming verbatim (sim STATUS_LOG.refusing and doBurn refusal text
    updated this pass to match the "that assign new XIDs" wording).
13. **The three-million margin exists so an admin can still VACUUM to recover** ✅
    routine-vacuuming states the reserve is to allow recovery.
14. **vacuum_freeze_table_age default 150 million; a normal vacuum turns aggressive there** ✅
    runtime-config-resource: `vacuum_freeze_table_age` default 150000000; routine-vacuuming
    describes the aggressive (whole-table) scan. ⚠️ effective max is 0.95 × freeze_max_age
    (noted in docs; not contradicted in prose).

## D. Recovery and failure modes

15. **Recovery order: release the horizon holder, THEN vacuum; single-user mode for a refusing
    cluster** ✅ routine-vacuuming (single-user `postgres --single` + database-wide VACUUM); the
    "unpin first" ordering follows from B8 — vacuuming while still pinned cannot advance
    relfrozenxid (asserted in test "even the forced vacuum cannot rescue a pinned cluster").
16. **Replication slot / hot_standby_feedback can pin the horizon with no local session** ✅
    monitoring-stats `pg_replication_slots.xmin`; replication-config `hot_standby_feedback` (same
    machinery verified in the MVCC explainer).
17. **Monitor `age(datfrozenxid)` / `age(relfrozenxid)`; find the oldest table via pg_class** ✅
    routine-vacuuming recommends monitoring xid age; pg_class.relfrozenxid / pg_database.
    datfrozenxid exposed and `age()` documented.
18. **idle_in_transaction_session_timeout as a defense** ✅ runtime-config-client.

## E. What real Postgres adds

19. **Visibility map all-frozen bit lets vacuum skip already-frozen pages** ✅ routine-vacuuming /
    storage; freezing cost scales with unfrozen pages.
20. **pg_xact ≈ 50 MB and pg_commit_ts ≈ 2 GB at 200M** ✅ routine-vacuuming verbatim on
    autovacuum_freeze_max_age storage translation.
21. **64-bit xid work proposed upstream, not yet shipped** ⚠️ transaction-id mentions the
    limitation and FullTransactionId internally; the "proposed for years, not landed" framing is
    accurate as of writing — flagged for the author to re-confirm at publish time.

## F. Simplifications (confirmed labeled in prose / SIMPLIFICATIONS)

- ⚠️ one cluster-wide number instead of per-table relfrozenxid / per-db datfrozenxid —
  "What real Postgres adds" + SIMPLIFICATIONS[0].
- ⚠️ xids in millions; real ids are individual integers compared modulo 2^32 — SIMPLIFICATIONS[1].
- ⚠️ freezing as an instant relfrozenxid jump rather than a page scan — SIMPLIFICATIONS[2].
- ⚠️ horizon = the one pinned snapshot, not a system-wide minimum — SIMPLIFICATIONS[3].
- ⚠️ workload only consumes xids; the parallel dead-tuple bloat is the MVCC piece —
  SIMPLIFICATIONS[4].
- ⚠️ recovery compressed to a single freeze vs the single-user-mode ritual — SIMPLIFICATIONS[5].

## Open items for human review before flipping draft:false

- [ ] Author reads every sentence; re-confirm the 64-bit-xid status (item 21) is current.
- [ ] Author exercises: healthy cycle, pinned runaway to refusing, the recovery order
      (release→freeze), forced-vacuum-can't-help-while-pinned, reduced-motion stepped mode, 360px
      width, tab backgrounded 30s, button spam.
- [ ] Confirm the `/mvcc-bloat` link resolves once both drafts publish.
