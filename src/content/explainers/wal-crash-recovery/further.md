# Further — wal-crash-recovery parking lot

Adjacent material deliberately cut from explainer #1 to keep it answering one
question ("how does a WAL survive a crash"). Each of these is a sentence in the
draft at most; several are their own future explainers.

## Cut to protect the single-question rule

- **ARIES undo / rollback.** The sim is redo-only: every transaction commits, so
  there is no undo pass. A real recovery has redo (repeating history) _and_ undo
  (rolling back transactions in flight at crash time), plus CLRs
  (compensation log records) so undo is itself idempotent on a second crash. This
  is the natural sequel explainer: "how a database rolls back a half-finished
  transaction after a crash."
- **Per-page redo LSN.** Real engines stamp each page with the LSN of its last
  applied change and skip WAL records the page has already seen during replay.
  The sim replays everything after the checkpoint. Mentioned in one labeled
  simplification; the mechanics (page LSN comparison, "repeating history" up to
  each page's own water line) are a whole topic.
- **Full-page writes, in depth.** The draft explains _why_ they exist (torn
  data-file pages) but not the second-order costs: WAL volume blowup right after
  a checkpoint, `full_page_writes = off` only being safe on filesystems that
  prevent partial writes (ZFS), and why BBU controllers don't help unless they
  guarantee full 8 KB page atomicity. Good candidate for a "what actually tears a
  page" piece.

## Adjacent depth (one-sentence neighbors)

- **Logical replication / streaming replication.** `synchronous_commit` has
  remote modes (`remote_write`, `on`, `remote_apply`) that wait on standbys, not
  only local flush. The WAL is the replication stream. Out of scope: this
  explainer is single-node durability only.
- **WAL archiving and PITR.** Continuous archiving of WAL segments plus a base
  backup gives point-in-time recovery — replay the log to an arbitrary LSN or
  timestamp. Same log, completely different operational story.
- **LSN-based PITR / recovery targets.** `recovery_target_lsn`,
  `recovery_target_time`, timelines. Belongs with the archiving piece.
- **Group commit internals.** `commit_delay` tuning is genuinely workload-shaped
  (CPU vs storage latency, concurrency). The draft shows the _effect_ under Load
  but not how to tune the delay. Possible short follow-up.
- **bgwriter and checkpoint spreading.** The sim writes all dirty pages at
  checkpoint instantly; Postgres spreads checkpoint I/O over
  `checkpoint_completion_target` and has a background writer trickling dirty
  pages out continuously. A "why your checkpoint causes a latency spike" piece.

## Sim fidelity notes (for a future v2 of the component)

- Model torn writes that damage a record _other_ than the batch's first, to show
  CRC catching a mid-tail corruption rather than always truncating at the head.
- Add an undo pass + at least one aborting transaction so the redo/undo split is
  visible.
- Add page LSNs so replay can visibly _skip_ a record an already-flushed page
  has seen.
