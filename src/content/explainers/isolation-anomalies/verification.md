# Verification checklist — isolation-anomalies (explainer #8)

Step 5 verification pass. Every checkable claim from the prose and the FIG. 01 caption,
verified against PRIMARY sources only: postgresql.org/docs/current and the peer-reviewed
SSI papers. Blog/SO answers are not verification sources.

Legend: ✅ verified (source + confirming text) · ⚠️ simplification (must be labeled in prose —
checked it IS) · ❌ wrong/unverifiable (fixed or cut).

Primary sources:

- PG Transaction Isolation: https://www.postgresql.org/docs/current/transaction-iso.html
- PG MVCC intro: https://www.postgresql.org/docs/current/mvcc-intro.html
- PG Explicit Locking: https://www.postgresql.org/docs/current/explicit-locking.html
- PG Error Codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
- Cahill/Röhm/Fekete, "Serializable Isolation for Snapshot Databases", SIGMOD 2008
- Ports/Grittner, "Serializable Snapshot Isolation in PostgreSQL", VLDB 2012
- Berenson et al., "A Critique of ANSI SQL Isolation Levels", SIGMOD 1995

Cross-check method: every scenario × level outcome quoted in the prose was executed against
the sim core (`isolationSim.test.ts`) and asserted there; the assertions ARE the cross-check.

---

## A. The dial and the three levels

1. **"SQL names four isolation levels; Postgres implements three distinct behaviors: Read
   Committed (default), Repeatable Read, Serializable"** ✅ transaction-iso: "you can request
   any of the four standard transaction isolation levels, but internally only three distinct
   isolation levels are implemented." Read Committed is "the default isolation level in
   PostgreSQL."
2. **"accepts READ UNCOMMITTED but runs it as Read Committed — never shows uncommitted data"**
   ✅ transaction-iso: Read Uncommitted is treated as Read Committed; PostgreSQL's MVCC does
   not allow dirty reads.
3. **RC takes a fresh snapshot per statement** ✅ transaction-iso: "a SELECT query … sees a
   snapshot of the database as of the instant the query begins to run"; each command within a
   Read Committed transaction sees a new snapshot.
4. **RR takes one snapshot at the first (non-control) statement and holds it** ✅
   transaction-iso: a Repeatable Read transaction "sees a snapshot as of the start of the
   first non-transaction-control statement in the transaction."
5. **Serializable uses the RR snapshot plus dependency monitoring** ✅ transaction-iso:
   Serializable "works exactly like Repeatable Read except that it monitors for conditions
   which could make execution … inconsistent with all possible serial … executions."

## B. Read Committed anomalies

6. **Non-repeatable read at RC (100 then 200), repeatable at RR (100 both)** ✅ definition of
   non-repeatable read in transaction-iso; sim asserts `:a=100`/`:a2=200` at RC and
   `:a2=100` at RR (test "non-repeatable read").
7. **Phantom at RC (count 2→3); RR prevents it though the standard allows it** ✅
   transaction-iso: the table of levels marks Repeatable Read phantom-safe in PostgreSQL with
   the note that the standard permits phantoms at that level but PostgreSQL's implementation
   does not. Sim asserts `:c2=3` at RC, `:c2=2` at RR (test "phantom").
8. **Lost update at RC: read-modify-write across statements loses an update (130 → 120)** ✅
   transaction-iso lost-update discussion; ⚠️ the single-statement `bal = bal + n` being safe
   at RC is the EvalPlanQual re-read behavior described in transaction-iso ("UPDATE will …
   re-evaluate"). Labeled in prose as the read/write-must-be-separate-statements caveat. Sim
   asserts final 120 at RC (test "lost update").
9. **Concurrent writers to the same row serialize (the blocker waits on a row lock)** ✅
   transaction-iso: a second UPDATE "will block waiting for the first updating transaction to
   commit or roll back." Sim models this as `blocked` state (test "blocking behaviour").

## C. Repeatable Read

10. **First-updater-wins; the woken writer aborts with `could not serialize access due to
    concurrent update` (40001)** ✅ transaction-iso (Repeatable Read section): on a concurrent
    update the transaction "will be rolled back with … ERROR: could not serialize access due
    to concurrent update." ✅ errcodes: `40001 serialization_failure`. Sim asserts abortReason
    `concurrent-update` at RR (test "lost update / Repeatable Read").
11. **RR (snapshot isolation) permits write skew because the two writes touch different rows**
    ✅ transaction-iso explicitly gives a write-skew example that Repeatable Read does NOT
    prevent and Serializable does. Sim asserts both commit and the invariant breaks at RR
    (test "write skew / Repeatable Read").

## D. Serializable / SSI

12. **rw-antidependency = T1 read a row T2 wrote; serializable ⟺ no cycle in the dependency
    graph** ✅ Cahill et al. §2 (multiversion serialization graph; rw-antidependency edges).
13. **Pivot theorem: every cycle contains a transaction with consecutive inbound + outbound
    rw edges** ✅ Cahill et al., Theorem 2.1 / the core SSI result; restated in Ports &
    Grittner §2. Sim's `isDangerousPivot` implements exactly this (in-edge ∧ out-edge to a
    committed txn).
14. **SSI abort message: `could not serialize access due to read/write dependencies among
    transactions` (40001)** ✅ transaction-iso (Serializable section) gives this exact message.
    Sim asserts abortReason `read-write-dependency` (test "write skew / Serializable").
15. **Serializable keeps SIRead predicate locks; the detector can produce false positives;
    applications must retry on 40001** ✅ transaction-iso: "monitoring … predicate locks";
    "applications using this level must be prepared to retry transactions due to serialization
    failures"; warns of overhead and that some serializable transactions may be rolled back
    unnecessarily. ✅ Ports & Grittner §3–4 (SIRead lock granularity, escalation, false
    positives, read-only optimization).
16. **Two distinct 40001 reasons (concurrent-update vs read/write-dependencies), same
    SQLSTATE** ✅ both messages appear in transaction-iso under class 40 in errcodes. ✅ matches
    sim's two `AbortReason`s.

## E. Cross-cutting

17. **`SELECT … FOR UPDATE` as the lower-level alternative to raising isolation** ✅
    explicit-locking (Row-Level Locks): `FOR UPDATE` locks rows against concurrent update.
18. **Berenson et al. introduced write skew (A5B) and lost update (P4) and argued levels are
    defined by phenomena** ✅ Berenson et al. §3 (P4 lost update, A5A/A5B read/write skew).
19. **Reading never blocks writing (MVCC basis of isolation)** ✅ mvcc-intro: "reading never
    blocks writing and writing never blocks reading."

## F. Simplifications (must be labeled — confirmed present in prose / SIMPLIFICATIONS)

- ⚠️ two transactions, few rows, snapshot = one commit counter — labeled in "What real
  Postgres adds" and SIMPLIFICATIONS[0,1].
- ⚠️ SSI reduced to the row-level pivot rule, aborting the commit that closes the cycle; real
  SSI is tuple/page-granular, may abort a different member, has false positives — labeled in
  "Watching the dependency graph", "What real Postgres adds", and SIMPLIFICATIONS[4].
- ⚠️ predicate reads cover only existing rows, so phantom-under-Serializable resolves to
  snapshot stability rather than a predicate-lock conflict — SIMPLIFICATIONS[5].
- ⚠️ instantaneous commit, no deadlock detection / timeouts / constraints — SIMPLIFICATIONS[6].

## Open items for human review before flipping draft:false

- [ ] Author reads every sentence.
- [ ] Author exercises all 12 scenario×level states, plus: spam Run buttons, switch level
      mid-run, switch scenario mid-run, reduced-motion stepped mode, 360px width, tab
      backgrounded 30s.
- [ ] Confirm the internal links to `/mvcc-bloat` resolve once both drafts publish (both are
      currently draft:true).
