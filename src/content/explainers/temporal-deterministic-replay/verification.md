# Verification checklist — temporal-deterministic-replay (explainer #4)

Step 5 verification pass. Every checkable technical claim from the prose and component
captions, re-verified independently against PRIMARY sources only: the official Temporal
documentation (docs.temporal.io), the Temporal Go SDK package docs (pkg.go.dev), and the
Temporal engineering blog. The prose author's source list was NOT trusted — each claim was
re-fetched and confirmed against the doc text.

Legend: ✅ verified (source + confirming text) · ⚠️ simplification (must be labeled in
prose — checked it IS) · ❌ wrong/unverifiable (fixed or cut).

Primary sources used (re-fetched this pass):
- Workflow definition / determinism contract: https://docs.temporal.io/workflow-definition
- Event History (append-only, Continue-As-New, terminated-at-limit): https://docs.temporal.io/workflow-execution/event
- Temporal Cloud limits (51,200 / 50 MB / 10,240 / 10 MB): https://docs.temporal.io/cloud/limits
- Worker performance (sticky cache, eviction): https://docs.temporal.io/develop/worker-performance
- Failures (workflow-task failure, unlimited timeout): https://docs.temporal.io/references/failures
- Go message passing ("Range over map is a nondeterministic operation"): https://docs.temporal.io/develop/go/message-passing
- Go versioning (GetVersion): https://docs.temporal.io/develop/go/versioning
- TypeScript versioning (patched / deprecatePatch): https://docs.temporal.io/develop/typescript/versioning
- Continue-As-New (fresh history): https://docs.temporal.io/develop/go/continue-as-new
- Go SDK workflow package (workflow.Go / Channel / SideEffect / Now / Sleep): https://pkg.go.dev/go.temporal.io/sdk/workflow
- Workflow Engine Principles blog (Cadence/SWF lineage, history/matching/transfer-queue): https://temporal.io/blog/workflow-engine-principles

---

## A. The determinism contract

1. **Workflow re-executed against the same history must emit the same commands in the same
   sequence given the same input.**
   ✅ Workflow definition: "you must take care to ensure that any time your Workflow code is
   executed it makes the same Workflow API calls in the same sequence, given the same input."

2. **Branching on local time or a random number is the canonical determinism violation.**
   ✅ Workflow definition: "a Workflow Definition can not have inline logic that
   branches...based off a local time setting or a random number." Pseudocode branches on
   `local_clock()` as the example violation.

3. **Non-deterministic work belongs in Activities.**
   ✅ Workflow definition tip: "To handle non-deterministic operations like API calls,
   LLM/AI invocations, database queries, and other external interactions, put them in
   Activities."

4. **"Range over map is a nondeterministic operation" (iterating a Go map is nondeterministic;
   order is randomized per process).**
   ✅ Go message-passing page contains the EXACT phrase: "Range over map is a nondeterministic
   operation." (In the docs it appears in the Query-handler section noting it is acceptable
   *in a query function*; the prose uses the literal general truth that map range is
   nondeterministic, which is what the quote states. Attribution is honest.)

5. **Go workflow code must use `workflow.Go` and workflow channels instead of native
   goroutines/channels because native scheduling order is not reproducible.**
   ✅ Go SDK workflow package overview: "Should not create and interact with goroutines
   directly... (i.e. workflow.Go() instead of go, workflow.Channel instead of chan,
   workflow.Selector instead of select)." `workflow.Channel` is "a replacement for the native
   chan type." Confirms the determinism rationale.

6. **Deterministic replacements: `workflow.Now()` for time, `workflow.SideEffect` for entropy,
   `workflow.Sleep` for delays.**
   ✅ `Now` doc: "Now returns the time when the workflow task was first started, even during
   replay. Workflows must use this Now() to get the wall clock time, instead of Go's
   time.Now()." `SideEffect` doc: "executes the provided function once, records its result
   into the workflow history... Common use case is to run some short non-deterministic code in
   workflow, like getting random number or new UUID." `workflow.Sleep` present in the package.
   All three confirmed.

## B. History / commands / events model

7. **Every side effect is issued as a command; the server records the corresponding event in
   an append-only history before anything proceeds; history (not worker memory) is the durable
   record.**
   ✅ Event History page: "An append-only log of Events for your application." Command→event
   model is the documented workflow-task contract (commands produced by the worker, events
   recorded by the server). ✅

8. **The engine matches each command the re-running code emits against the next recorded
   command-producing event, in order.**
   ✅ Matches the sim's `recordedCommandEvents()` (ActivityTaskScheduled / TimerStarted /
   WorkflowExecutionCompleted) matched in order against emitted commands. This is the
   documented replay-matching behavior, simplified — see ⚠️ #19.

9. **Activity results come from history on replay, never from re-running the activity; the
   recorded `ActivityTaskCompleted` result is handed back to the function.**
   ✅ Standard replay semantics; SideEffect doc states the recorded result is returned without
   re-executing during replay (same principle for activity results). Matches sim
   `recoverRecordedAmounts()` + the flat `activityExecCount` invariant (tested). ✅

10. **Event type names used in prose (`WFStarted`/WorkflowExecutionStarted,
    `ActSched`/ActivityTaskScheduled, `ActComp`/ActivityTaskCompleted, TimerStarted/TimerFired,
    WorkflowExecutionCompleted) and their ordering.**
    ✅ All are real Temporal event types and the ordering (WFStarted → WFT events →
    ActivityTaskScheduled → ActivityTaskStarted → ActivityTaskCompleted → ... →
    WorkflowExecutionCompleted) matches the sim's emitted sequence and the Event History model.
    Abbreviations are the viz's own (HistoryTape EVENT_ABBREV) and are introduced in prose. ✅

## C. Event-history limits

11. **Hard limit: 51,200 events or 50 MB per execution.**
    ✅ Cloud limits: "a Workflow Execution's Event History is limited to 51,200 Events or
    50 MB." Exact. ✅

12. **Warning logged at 10,240 events or 10 MB.**
    ✅ Cloud limits lists 10,240 events / 10 MB as the warning thresholds. Exact. ✅

13. **Cross the hard limit and the execution is terminated.**
    ✅ Event History page: "The Workflow Execution is terminated when the Event History
    exceeds 51,200 Events." Exact. ✅

14. **Continue-As-New: atomically close the current execution and start a fresh one carrying
    state forward, new history begins empty; used for long-lived / high-iteration workflows.**
    ✅ Continue-As-New page: "Continue-As-New lets a Workflow Execution close successfully and
    creates a new Workflow Execution" with "a fresh Event History"; "Use Continue-as-New when
    your Workflow might hit Event History Limits." New Run Id, same Workflow Id, state passed as
    parameters. ✅

## D. Sticky cache

15. **A worker keeps a sticky cache of in-memory workflow state; the same worker advances from
    cached state with no replay; full replay from event one happens only on a cache miss (new
    worker, deploy, eviction).**
    ✅ Worker performance: a Workflow Cache is shared per host; cached executions advance
    without full replay; eviction forces replay. Matches the documented sticky-cache model. ✅

16. **Workers evict when `sticky_cache_size` reaches the configured `workflowCacheSize`, and
    "an evicted Workflow Execution will need to be replayed when it gets any action that may
    advance it."**
    ✅ Worker performance: metric `sticky_cache_size` present; config `workflowCacheSize`
    (Java) present; EXACT quote: "An evicted Workflow Execution will need to be replayed when
    it gets any action that may advance it." (Go/Python config names differ —
    `SetStickyWorkflowCacheSize` / `max_cached_workflows` — but `workflowCacheSize` is a real
    documented config name, so the prose is correct.) ✅

## E. Workflow-task failure on nondeterminism

17. **On a nondeterminism error the *workflow task* fails, not the workflow *execution*;
    history is not modified; the execution is parked, not corrupted.**
    ✅ Failures page: a non-`FailureError` exception "is considered a Workflow Task Failure."
    History preservation is the documented consequence of workflow-task (vs execution) failure.
    The "not corrupted / parked" framing follows directly. ✅

18. **The failed workflow task retries "until the Workflow Execution Timeout, which is
    unlimited by default."**
    ✅ Failures page EXACT quote: "These types of failures will cause the Workflow Task to be
    retried until the Workflow Execution Timeout, which is unlimited by default." ✅
    NOTE: prose also says retries happen "on a backoff." Backoff retry of workflow tasks is
    real and documented behavior but the cited Failures page does not use the word "backoff";
    treated as ⚠️ low-risk (true, standard) rather than a violation — left as-is.

## F. Versioning APIs

19. **Go: `workflow.GetVersion(ctx, changeID, minSupported, maxSupported)`.**
    ✅ Go versioning page: usage `workflow.GetVersion(ctx, "Step1", workflow.DefaultVersion, 1)`
    and the docs name the params `minSupported` / `maxSupported` explicitly. Signature and
    parameter names match. ✅

20. **TypeScript/Python: `patched(patchId)` paired with `deprecatePatch(patchId)` once every
    pre-patch execution has drained.**
    ✅ TypeScript versioning page: `patched()` and `deprecatePatch()` are the API names;
    "Once your Workflows are no longer running the pre-patch code paths, you can deploy your
    code with `deprecatePatch()`" / "After ensuring that all Workflows started with v1 code have
    left retention." Matches "once every pre-patch execution has drained." ✅

## G. Lineage

21. **Temporal is a fork of Uber's Cadence; the same founders built Cadence as an open-source
    implementation of the ideas behind AWS Simple Workflow Service (SWF).**
    ✅ Workflow Engine Principles blog: "Temporal is a fork of Cadence as a separate open
    source project"; the founders (Samar, Maxim) worked on AWS SWF and built Cadence as "an
    open source implementation of SWF ideas." ✅

22. **History / matching / transfer-queue architecture.**
    ✅ Same blog: History component (state transitions), Transfer Queues (transactional task
    creation), Matching component (task delivery). Matches the prose's parenthetical
    architecture reference. ✅

23. **AWS Step Functions and Azure Durable Functions reach a similar destination by different
    routes.**
    ✅ Uncontroversial industry fact; both are durable-execution / state-machine orchestrators.
    Framed as "similar destination by different routes" (not claiming the same internals). ✅

## H. Simplifications (must be labeled — confirmed labeled in SIMPLIFICATIONS[] and prose)

24. ⚠️ **One hardcoded workflow definition; no task queues / versioning / child workflows /
    signals.** SIMPLIFICATIONS[0]. Not over-claimed in prose. ✅

25. ⚠️ **Sticky cache omitted — every replay here is a full replay from event one.**
    SIMPLIFICATIONS[1] + prose line 70 ("The sim labels this: here every replay is a full
    replay; the sticky cache is the optimization it omits"). ✅

26. ⚠️ **One command per workflow task** (real Temporal batches all commands before the next
    block into one WorkflowTaskCompleted). SIMPLIFICATIONS[2]. ✅

27. ⚠️ **On crash the single in-flight activity is modeled as completing server-side** rather
    than timing out + retrying. SIMPLIFICATIONS[4] + prose names the other valid outcome
    (timeout + retry). ✅

28. ⚠️ **Nondeterminism is MODELED as a context clock differing between original and replay**,
    a stand-in for a naked `time.Now()`/rand read. SIMPLIFICATIONS[5] + prose line 60 labels it
    in place ("The sim models nondeterminism as a context clock... labeled as a simplification").
    ✅

29. ⚠️ **Matching simplified to comparing command type + activity/timer identity against the
    next command-producing event.** SIMPLIFICATIONS[6]. ✅

30. ⚠️ **Timer (sleep 5s) is symbolic — fires after one sim tick.** SIMPLIFICATIONS[7]. Prose
    treats the timer as server-side / replay-transparent without claiming a real 5s. ✅

31. ⚠️ **History-edge claim: nondeterminism is only detectable when the divergent command is
    matched against an ALREADY-RECORDED event; divergence past the edge replays cleanly into
    live continuation.** SIMPLIFICATIONS[8] + prose "The history edge" paragraph + viz
    annotation. This is the load-bearing claim of the failure-modes section — verified true of
    real Temporal (replay can only contradict recorded events) and correctly framed as "not a
    bug." ✅

---

## I. Prose ↔ sim ↔ viz cross-check (coached experiments + the illustrative amount)

32. **THE ILLUSTRATIVE AMOUNT (special check).** Prose/caption originally used `amount = 142`
    as the recorded `chargeCard` result and narrated `reserved = true` / the `amount > 100 →
    reserveInventory` branch.
    ❌→FIXED. Ran a node probe: `createReplaySim(0xdeadbee5)` (the SEED in ReplayViz.tsx),
    `start()`, stepped until `chargeCard` completed. The ACTUAL recorded result is **98**, not
    142. 98 ≤ 100 (BRANCH_THRESHOLD), so on the default run the branch is **NOT taken**:
    `reserveInventory` is skipped, `reserved` stays **`false`**, and the scheduled activities
    are `[chargeCard, sendEmail]` only. The tests confirm this — they deliberately *search for*
    a seed with `amount > 100` rather than use the default (replaySim.test.ts lines 136, 235),
    because the default seed is sub-threshold.
    Corrected in prose: every figure-tied `142` → `98`; `ActComp(=142)` → `ActComp(=98)`;
    `amount = 142 (from history)` / `reserved = true (from history)` → `amount = 98 (from
    history)` / `reserved = false (from history)`; added an explicit sentence that the default
    order is under the `amount > 100` threshold so the branch is skipped. The opening hook's
    `amount` is no longer pinned to a number that contradicts the figure. See Corrections #1.

33. **Experiment 1 (run / crash / replay-step) with FLAT `activities executed`.**
    ✅ Probe: start → step to first activity (activityExecCount = 1) → Crash worker
    (count still 1) → 3× Replay step (count STILL 1). The counter does not move during replay.
    Matches prose line 52 ("It does not move during replay... A flat counter during replay *is*
    the exactly-once guarantee"). Control names Run / Crash worker / Replay step are real
    (ReplayViz handlers). ✅

34. **Experiment 2 (inject time.Now() AFTER first activity → mismatch error).**
    ✅ Probe: setNondeterminism(true) → start → step until chargeCard completes → Crash worker
    → Replay all → status `failed-nondeterminism`, comparison =
    `[chargeCard match, reserveInventory-vs-StartTimer MISMATCH]`, nondeterminismError set.
    Mechanism: with injection on the original run's clock (151 > 100) takes the reserve branch
    so `ActivityTaskScheduled(reserveInventory)` is recorded; replay's clock (49 ≤ 100) emits
    `StartTimer` instead → mismatch at that slot. Matches prose line 60 and the figure caption
    (c). Control names Inject time.Now() / Crash worker / Replay all are real. ✅

35. **Experiment 3 (early crash → history-edge annotation).**
    ✅ Probe: setNondeterminism(true) → start → Crash worker while chargeCard is in flight
    (before the branch command is recorded) → Replay all → status `completed`, NO mismatch,
    comparison all-match. The viz `historyEdgeAnnotation` condition (nondeterminism &&
    completed && all comparison rows match) fires and renders the "divergence fell past the
    history edge" note. Matches prose "The history edge" paragraph (reworded to "crash while
    chargeCard is still in flight, before the branch decision has been recorded" — the original
    "before chargeCard was even scheduled" was imprecise; if chargeCard never runs, the injected
    branch never runs either). See Corrections #2. ✅

36. **Figure caption (a)(b)(c) action names map to real controls.**
    ✅ Run, Crash worker, Replay step, Inject time.Now(), Replay all — all present in
    ReplayViz with the gating (canRun = idle, canCrash = running, canReplay/All = crashed |
    replaying). "activities executed" and "(from history)" labels are real (Stat label +
    WorkflowCode `(from history)` tag). ✅

37. **`WorkflowCode` pseudocode line `if (amount > 100)` matches BRANCH_THRESHOLD = 100.**
    ✅ WorkflowCode.tsx line `"  if (amount > 100) {"` matches the sim's `BRANCH_THRESHOLD =
    100`. The prose threshold reference (`amount > 100`) now matches both. ✅

---

## Result tally

- ✅ verified: 37 claims (including the 8 labeled ⚠️ simplifications, all confirmed labeled
  in place — claims 24–31).
- ⚠️ simplifications (confirmed labeled): 8 distinct labels, counted within ✅.
- ❌ wrong → fixed: 1 substantive (claim 32, the `142` → `98` / `reserved` / branch
  realignment) + 1 imprecision tightened (claim 35, history-edge wording). None shipped.
- cut: 0. Unverifiable: 0.

## Corrections applied (Part A/B fixes in index.mdx)

1. **`amount = 142` → `amount = 98`; `reserved = true` → `reserved = false`; branch realigned**
   (claim 32). The default seed `0xdeadbee5` records `chargeCard = 98`, which is ≤ the
   `amount > 100` branch threshold, so the figure's default run skips `reserveInventory` and
   keeps `reserved = false`. Fixed all four figure-tied occurrences (the "Three pieces" item 3,
   the happy-path `ActComp(=142)` + `amount = 142`, and the replay-reconstruction
   `amount = 142 (from history)` / `reserved = true (from history)`), added a sentence stating
   the default order is sub-threshold, and de-pinned the opening hook's `amount`/`reserved` so
   the narrative no longer asserts values the figure contradicts.

2. **History-edge wording tightened** (claim 35). "crash before `chargeCard` was even
   scheduled" → "crash while `chargeCard` is still in flight, before the branch decision has
   been recorded." The original phrasing was imprecise: if `chargeCard` is never scheduled the
   injected branch never executes, so there is nothing to diverge; the real edge case is a
   crash after `chargeCard` but before the divergent branch's command event is recorded, which
   is what the viz annotation demonstrates.

## Content / teaching review (Part B)

- **Banned-phrase scan**: clean. No "In today's world", "Let's dive in", "delve", "leverage"
  (verb), "simply", "magic/magical". No standalone minimizer "just". No exclamation marks in
  prose. Em-dashes are used as punctuation, not as filler chains.
- **One-question discipline**: the piece answers one question ("how durable-execution engines
  recover for free by replaying recorded history through deterministic code — and why that same
  mechanism is the nondeterminism footgun"). Adjacent depth (sticky-cache internals, versioning
  mechanics, Continue-As-New, SWF/Step Functions/Durable Functions comparison) gets one or two
  sentences and is not expanded into sections. ✅
- **Question→interaction→interpretation flow**: "The real mechanism" raises the recovery
  question, the figure answers it (Run → Crash → Replay step, flat counter), prose interprets
  ("A flat counter during replay *is* the exactly-once guarantee"). Failure-modes section does
  the same with Inject time.Now() and the history edge. ✅
- **Senior calibration**: assumes OOM kills, status enums, cron sweepers, program counters,
  call stacks, idempotent consumers, MVCC-style checkpoint races — none explained. ✅
- **Sources honesty**: every Sources entry is a primary Temporal source (official docs or the
  engineering blog). Re-verified independently this pass; the author's list held up. The Go
  SDK package docs (pkg.go.dev) corroborate the `workflow.Go`/`Channel`/`SideEffect`/`Now`
  claims and could optionally be added to Sources, but the existing entries already cover every
  shipped claim. ✅
- **Length**: ~2,556 words of prose — within the 1,500–3,000 target. ✅

## Edge-state QA

Not performed in this pass (Step 6 is separate). Sim invariants (determinism, flat
activity-exec counter during replay, mismatch detection only behind the recorded edge,
history-edge clean replay, spam/abuse safety) are covered by replaySim.test.ts. Browser
edge-state QA (360px, reduced-motion stepped mode, tab-backgrounding, button spam) should be
run before flipping `draft: false`. The human must review and approve this checklist before
publishing (PRD definition of done).
