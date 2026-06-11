# Further — temporal-deterministic-replay parking lot

Material deliberately cut from `index.mdx` to keep it answering one question
("how does a durable workflow engine reconstruct local state after a crash via
deterministic replay"). Each item is a sentence in the draft at most; several are
their own future explainers.

## Cut to protect the single-question rule

- **Signals.** A running workflow can receive asynchronous input (a `SignalWorkflow`
  call) that lands in history as a `WorkflowExecutionSignaled` event and wakes the
  workflow. Replay treats a signal like any other recorded event — it resumes the
  blocked select with the recorded payload. The sim has no signal channel; adding
  one is a clean "external input during a deterministic replay" interaction.
- **Queries.** A query (`QueryWorkflow`) reads workflow state without mutating
  history — it runs the workflow function up to its current point and returns a
  derived value, and crucially is *not* recorded as an event. The determinism
  contract still applies (a query handler must not have side effects). Worth its
  own piece on "reading consistent state from a thing that only exists as a log."
- **Child workflows.** `ExecuteChildWorkflow` schedules a separate workflow
  execution with its own history; the parent records `StartChildWorkflowExecution`
  /`ChildWorkflowExecutionCompleted` events and replays against them the same way
  it replays activities. The sim models only activities and timers. Child-workflow
  fan-out and the parent-close policy are a "composing durable executions" topic.
- **Schedules / cron.** Temporal Schedules (and the older cron syntax) start new
  workflow executions on a recurrence. This is orchestration *above* a single
  execution's replay, not part of it; out of scope here.

## Adjacent depth (one-sentence neighbors)

- **SideEffect and MutableSideEffect.** The escape hatch for "I need a
  nondeterministic value (a UUID, a random number) inside workflow code": run it
  once, record the result in history, and replay it from there. The sim folds the
  same idea into how activity results are replayed; `SideEffect` is the explicit
  API for non-activity entropy. A short follow-up could let the reader wrap a
  `time.Now()` in `SideEffect` and watch the nondeterminism error disappear.
- **Local activities.** A short activity executed inline by the worker (no separate
  activity task round-trip) but still recorded so its result replays. Different
  performance/latency story; same replay principle.
- **Activity retries, heartbeats, timeouts.** The sim completes every activity once
  after a fixed delay. Real activities have retry policies, heartbeat-based
  liveness, and four distinct timeouts (schedule-to-start, start-to-close,
  schedule-to-close, heartbeat). The "an activity that times out and retries vs one
  that completes server-side after a worker crash" branch is noted in the prose but
  not interactive here.
- **Workflow task batching.** Real Temporal batches every command a workflow emits
  before it next blocks into a single `WorkflowTaskCompleted`. The sim emits one
  command per workflow task for clarity. Mentioned in a labeled simplification.
- **Continue-As-New, in depth.** The draft cites the 51,200-event / 50 MB limit and
  names Continue-As-New as the fix, but the mechanics (atomically closing the
  current execution and starting a fresh one with carried-over state, so the new
  execution's history starts empty) deserve their own "how a workflow runs forever
  without an unbounded history" piece.

## Sim fidelity notes (for a future v2 of the component)

- Model the sticky cache explicitly: a "warm worker" path that resumes from cached
  in-memory state with no replay, versus the "cold worker / eviction" path that
  replays the full history. Right now every replay is a full replay.
- Add a `SideEffect`/`GetVersion` control so the reader can *fix* the injected
  `time.Now()` nondeterminism and watch the mismatch turn into a recorded marker.
- Model an activity timeout + retry on crash as an alternative to the
  complete-server-side simplification, so both crash outcomes are visible.
- Show command batching: multiple commands collapsing into one
  `WorkflowTaskCompleted` rather than one event per command.
