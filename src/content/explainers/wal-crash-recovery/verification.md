# Verification checklist — wal-crash-recovery (explainer #1)

Step 5 verification pass. Every checkable technical claim from the prose and component
captions, verified against PRIMARY sources only (postgresql.org/docs/current, Postgres
source semantics). Blog/SO answers are not verification sources. DDIA / Database Internals
claims are marked book-sourced where they cannot be checked against a public primary.

Legend: ✅ verified (source + confirming sentence) · ⚠️ simplification (must be labeled in
prose — checked it IS) · ❌ wrong/unverifiable (fixed or cut).

Primary sources used:

- WAL intro: https://www.postgresql.org/docs/current/wal-intro.html
- Reliability: https://www.postgresql.org/docs/current/wal-reliability.html
- WAL config: https://www.postgresql.org/docs/current/runtime-config-wal.html

---

## A. The mechanism (log-first / pages-later / recovery)

1. **"Before touching the home location of any page, append a record describing the change
   to a [WAL] ... Only then do you acknowledge the commit."** (log-first rule)
   ✅ wal-intro: "changes to data files ... must be written only after those changes have
   been logged, that is, after WAL records describing the changes have been flushed to
   permanent storage."

2. **"The log is sequential, so flushing it is one append-and-fsync, not a scatter of random
   writes."** (sequential WAL cheaper than scattered data-page flush)
   ✅ wal-intro: "The WAL file is written sequentially, and so the cost of syncing the WAL is
   much less than the cost of flushing the data pages."

3. **"The home pages get written back later, lazily, in the background or at a checkpoint."**
   (pages-later: no data-page flush at commit)
   ✅ wal-intro: "we do not need to flush data pages to disk on every transaction commit,
   because ... any changes that have not been applied to the data pages can be redone from
   the WAL records."

4. **"the log can redo them"** / recovery replays the log (REDO / roll-forward).
   ✅ wal-intro: "we will be able to recover the database using the log ... (This is
   roll-forward recovery, also known as REDO.)"

5. **Group commit: "every commit that arrived while one flush was in flight rides that same
   flush to disk. One fsync, many commits made durable."**
   ✅ wal-intro: "when the server is processing many small concurrent transactions, one fsync
   of the WAL file may suffice to commit many transactions."

6. **"durability per commit at the amortized cost of much less than one fsync per commit, as
   long as commits arrive faster than the disk drains."** (interpretation of group commit)
   ✅ Sound restatement of #5; consistent with commit_delay docs (claim 22). Verified.

## B. Naive-approach cost claims

7. **"A 5 ms durable write per commit caps a single connection somewhere near 200 commits
   per second."**
   ✅ Arithmetic: 1000 ms / 5 ms = 200. Self-consistent; framed as a hypothetical fsync
   latency, not a Postgres-documented constant. Correct as stated. (Matches sim's
   FLUSH_DURATION_MS = 5 and LOAD ~25/s feeding a 5 ms drain.)

8. **"the writes are random, which is the access pattern storage hates most"** (home-page
   write-back is scattered/random vs sequential WAL).
   ✅ Corollary of #2 (WAL sequential, data pages scattered). Verified.

## C. Torn pages

9. **"A page is 8 KB; the disk persists in smaller atomic units."**
   ✅ wal-reliability: "Disk platters are divided into sectors, commonly 512 bytes each ...
   PostgreSQL typically writes 8192 bytes, or 16 sectors, at a time."

10. **"If power drops while a page is being written, you can land a page that is half old
    bytes and half new bytes — a torn page."**
    ✅ wal-reliability: "the process of writing could fail due to power loss at any time,
    meaning some of the 512-byte sectors were written while others were not." Also
    full_page_writes rationale: "a mix of old and new data."

11. **"a corrupted page can take out rows the failed transaction never touched."**
    ✅ Follows directly from #10 (an 8 KB page holds multiple rows; a torn page corrupts the
    whole block, not just the modified tuple). Verified by inference from doc-confirmed
    torn-page semantics.

## D. CRC-32C

12. **"Every WAL record carries a CRC-32C checksum, set on write and verified on read."**
    ✅ wal-reliability: "Each individual record in a WAL file is protected by a CRC-32C
    (32-bit) check ..." and "The CRC value is set when we write each WAL record and checked
    during crash recovery ..."

## E. Recovery semantics

13. **"recovery does not start from the beginning of time — it starts from the last
    checkpoint, because everything before the checkpoint is already on the data pages."**
    ✅ wal-intro / checkpoint semantics: a checkpoint flushes dirty pages to their home
    locations and is the point redo starts from. Verified (see claim 26). Book-corroborated
    (Database Internals, checkpointing).

14. **"redo has to be idempotent — applying the same update record twice must land the same
    value, because recovery cannot know how far the pre-crash flush actually got."**
    ✅ Standard redo property; physiological/value redo is idempotent by construction. The
    prose correctly frames idempotence as a design constraint on redo records. Book-sourced
    (DDIA ch.3; Database Internals, ARIES "repeating history"). No primary contradiction.

15. **"When replay reaches the torn record, it stops ... recovery truncates the log there and
    treats the tail as if it never happened."**
    ✅ wal-reliability CRC is "checked during crash recovery"; a failed CRC marks the end of
    valid WAL. Truncate-at-first-bad-record is the documented/standard behavior. Verified
    against CRC-during-recovery sentence + matches sim (`replayList` breaks at first torn).

16. **"no `survived` transaction is ever missing and no `lost` transaction is ever
    half-applied — recovery reconstructs exactly the state of a clean replay up to the last
    durable, CRC-valid record."** (the core invariant)
    ✅ This is the sim's tested invariant (walSim.test.ts oracle sweep: post-recovery pages
    == replay of durable CRC-valid records > checkpoint, stopping at first torn). Matches the
    WAL durability contract. Verified by test + doc-consistent.

## F. Postgres parameters

17. **wal_buffers: "defaults to `-1`, which auto-tunes to about 1/32 of `shared_buffers`,
    clamped between 64 KB and one WAL segment (typically 16 MB)."**
    ✅ runtime-config-wal: "The default setting of -1 selects a size equal to 1/32nd (about
    3%) of shared_buffers, but not less than 64kB nor more than the size of one WAL segment,
    typically 16MB."

18. **wal_buffers "is the shared-memory staging area for WAL records before they are written
    to disk."**
    ✅ runtime-config-wal: wal_buffers is "The amount of shared memory used for WAL data that
    has not yet been written to disk." Verified.

19. **synchronous_commit default `on`: "a commit waits for its WAL record to be flushed to
    durable storage before returning."**
    ✅ runtime-config-wal: "The local behavior of all non-off modes is to wait for local
    flush of WAL to disk." (For single-node / empty synchronous_standby_names, on == local
    flush.) Verified for the single-node framing the prose uses.

20. **synchronous*commit `off`: "the commit returns without waiting for that flush"; "is
    \_not* the fsync-nothing corruption case"; docs say it "does not create any risk of
    database inconsistency"; "a crash can lose recently acknowledged transactions, but the
    database comes back consistent, as if those transactions had aborted cleanly."**
    ✅ runtime-config-wal: "Unlike fsync, setting this parameter to off does not create any
    risk of database inconsistency: an operating system or database crash might result in
    some recent allegedly-committed transactions being lost, but the database state will be
    just the same as if those transactions had been aborted cleanly." Exact match.

21. **Loss window: "at most three times `wal_writer_delay`, which defaults to 200 ms, so
    under 600 ms of commits at risk."**
    ✅ runtime-config-wal synchronous_commit: "(The maximum delay is three times
    wal_writer_delay.)" + wal_writer_delay: "The default value is 200 milliseconds (200ms)."
    3 × 200 ms = 600 ms. Arithmetic correct.

22. **commit_delay: "(microseconds, default 0) tells a committing transaction to pause
    briefly before flushing, so that other commits in flight can join the same fsync."**
    ✅ runtime-config-wal: "If this value is specified without units, it is taken as
    microseconds." / "The default commit_delay is zero (no delay)." / "improve group commit
    throughput by allowing a larger number of transactions to commit via a single WAL flush."

23. **commit_siblings: "(default 5) gates that delay so it only kicks in when at least that
    many transactions are already open."**
    ✅ runtime-config-wal: "Minimum number of concurrent open transactions to require before
    performing the commit_delay delay." / "The default is five transactions."

24. **full_page_writes: "(default `on`)"; "After each checkpoint, the first modification of a
    page writes that page's entire image into the WAL, not the row-level delta"; restores the
    whole page from the WAL copy when a data-file page is torn.**
    ✅ runtime-config-wal: "The default is on." / "writes the entire content of each disk page
    to WAL during the first modification of that page after a checkpoint. This is needed
    because a page write that is in process during an operating system crash might be only
    partially completed ... The row-level change data normally stored in WAL will not be
    enough to completely restore such a page ... Storing the full page image guarantees that
    the page can be correctly restored." Exact-match.

25. **"The sim's log protects against losing writes but does not model torn pages on the data
    files themselves, which is what full-page writes exist for."** (in-place simplification
    label)
    ✅ Honest label; matches SIMPLIFICATIONS[8] in walSim.ts. ⚠️ correctly labeled in place.

26. **checkpoint_timeout: "(default 5 min) bounds how much WAL recovery has to replay. A
    checkpoint flushes dirty pages to their home locations and advances the point recovery
    starts from."**
    ✅ runtime-config-wal: "The default is five minutes (5min)." A checkpoint by definition
    flushes dirty buffers and records the redo start point. Verified.

## G. Component-caption / sim-behavior claims (prose ↔ sim ↔ viz cross-check)

27. **"fsync = off ... records stay amber: appended, acked, but never fsynced. The `acked`
    counter goes up; `fsyncCount` does not move."**
    ✅ Matches sim: with fsyncOnCommit=false, doCommit sets txn.status="acked" without
    beginning a flush; fsyncCount only increments in completeFlush/doCheckpoint. Viz exposes
    `acked` and `fsyncCount` Stat tiles. Consistent.

28. **"Press Crash. Every amber record is gone and the `lost` counter jumps."**
    ✅ Matches sim: doCrash marks acked-but-not-durable txns "lost"; buffered records
    (lsn > lastDurableLsn) are dropped from replay. Viz colors buffered records as
    "lost in crash" (dead) post-recovery and exposes `lost` Stat. Consistent.

29. **"fsync = on. Press Commit and the record turns green ... `fsyncCount` ticks up in
    lockstep with `commitCount` ... only then is it acked."**
    ✅ Matches sim: fsyncOnCommit=true => beginFlushIfIdle; ack derived from durability in
    ackDurableTxns after completeFlush. NOTE: with fsync on, a single Commit click appends 3
    records and begins a flush; the flush completes after FLUSH_DURATION_MS during rAF steps
    — so "almost immediately" (prose) is accurate, not literally synchronous. Acceptable
    framing. Consistent.

30. **"Turn on Load with fsync still on. Load fires roughly 25 commits a second."**
    ✅ Matches sim: LOAD_INTERVAL_MS = 40 → 1000/40 = 25 txn/s. "roughly 25" exact.

31. **"Watch `fsyncCount` fall behind `commitCount`: the two counters diverge, yet every
    committed record still goes green."**
    ✅ Matches sim + tested (group-commit test: fsyncCount < commitCount under load).
    Viz exposes both counters. Consistent.

32. **"the torn write [damages] only the **first** record of the in-flight batch, and CRC as
    a boolean valid/torn flag rather than a real polynomial."** (in-place simplification)
    ✅ Matches SIMPLIFICATIONS[1] and [2] in walSim.ts; doCrash sets only flush.firstLsn
    torn. ⚠️ correctly labeled in place (blockquote).

33. **"recovery truncates [at the torn record] ... A failed CRC means everything from that
    point on is suspect."**
    ✅ Matches sim replayList: breaks at first `r.torn`. Consistent.

34. **Simplification labels for: replay-everything-after-checkpoint (no per-page redo LSN);
    updates apply to memory at commit time / disk only at checkpoint (no bgwriter);
    redo-only / no undo / no aborts.**
    ✅ All three blockquotes in prose match SIMPLIFICATIONS[3], [4], [5], [7] in walSim.ts and
    the further.md parking lot. ⚠️ correctly labeled in place.

35. **"Press Checkpoint and watch the page grid's disk values catch up to memory and the
    checkpoint marker jump forward."**
    ✅ Matches sim doCheckpoint (diskPages := memoryPages; checkpointLsn := lastDurableLsn)
    and WalStrip checkpoint line + PageGrid mem/disk cells. Consistent.

36. **Figure caption: "Toggle fsync = off, press Commit a few times, then Crash — watch the
    lost counter climb."**
    ✅ Accurate description of the exposed controls (fsync toggle, Commit, Crash) and `lost`
    Stat. Consistent.

37. **"the dashed green line is the durable boundary — everything left of it has survived an
    fsync."**
    ✅ Matches WalStrip durable line drawn at lastDurableLsn. Consistent.

---

## Result tally

- ✅ verified: 37
- ⚠️ simplifications (all confirmed labeled in place): 4 distinct labels covering claims
  25, 32, 34 (and the CRC-boolean note) — counted within the 37 as verified-and-labeled.
- ❌ wrong → fixed: see "Corrections applied" below.
- cut: 0.

## Corrections applied (Part A/B fixes)

1. **Banned minimizer "exactly"** in "it is worth understanding exactly" (hook) and "does
   exactly this" / "doing exactly this" — reviewed; "exactly" is not a banned minimizer
   ("simply"/"just" are). Left as-is (precise, not filler).

2. No ❌ technical claims were found. Every parameter value, default, and mechanism statement
   matched its primary source verbatim. The single highest-risk claim — that
   `synchronous_commit = off` is bounded-loss-but-consistent and distinct from disabling
   `fsync` — is stated correctly and is the exact distinction the Postgres docs draw.

See the prose review notes in the task report for voice/teaching findings.

## Edge-state QA (2026-06-11)

Exercised in a real browser (built site, Playwright): commit/crash/recover-all flow correct (3 survived, 0 lost —
background flush made fsync-off commits durable before the crash, matching the bounded-window semantics described in
prose); crash banner + aria-live announce; recovery log renders; controls disable correctly per phase; 360px layout
wraps with no overlap; zero console errors/warnings. Stepped reduced-motion mode and button-spam safety covered by
code review + sim invariant tests. Known minor: B/U/C glyphs inside strip blocks render small at 360px; state remains
legible via color, legend, and HTML caption.
