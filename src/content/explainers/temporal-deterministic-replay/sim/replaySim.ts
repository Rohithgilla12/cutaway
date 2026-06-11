export type WorkerStatus = "idle" | "running" | "crashed" | "replaying" | "failed-nondeterminism" | "completed";

export type EventType =
  | "WorkflowExecutionStarted"
  | "WorkflowTaskScheduled"
  | "WorkflowTaskStarted"
  | "WorkflowTaskCompleted"
  | "ActivityTaskScheduled"
  | "ActivityTaskStarted"
  | "ActivityTaskCompleted"
  | "TimerStarted"
  | "TimerFired"
  | "WorkflowExecutionCompleted";

export type CommandType = "ScheduleActivityTask" | "StartTimer" | "CompleteWorkflowExecution";

export type ActivityName = "chargeCard" | "reserveInventory" | "sendEmail";

export interface HistoryEvent {
  eventId: number;
  type: EventType;
  // human-readable payload summary for the viz
  payload: string;
  // the command-producing event types carry the structured detail replay matches against
  activity?: ActivityName;
  // recorded activity result (chargeCard records the amount that drove the branch)
  result?: number;
  // the timer this event started/fired
  timerId?: string;
  replayCursor: boolean;
}

export interface Command {
  type: CommandType;
  activity?: ActivityName;
  timerId?: string;
}

export type WorkflowStepId =
  | "start"
  | "chargeCard"
  | "branch"
  | "reserveInventory"
  | "timer"
  | "sendEmail"
  | "complete"
  | "done";

export interface CodeProgress {
  // the workflow line the (re)execution last reached
  step: WorkflowStepId;
  line: number;
  // local state the workflow function has reconstructed so far
  amount: number | null;
  reserved: boolean | null;
}

export type ComparisonOutcome = "match" | "mismatch" | "pending";

export interface ComparisonRow {
  index: number;
  // what history recorded for this command-producing slot
  recorded: string;
  // what the replayed workflow code emitted at this slot
  emitted: string;
  outcome: ComparisonOutcome;
}

export type ActivityState = "scheduled" | "started" | "completed" | "timed-out";

export interface ActivityView {
  activity: ActivityName;
  state: ActivityState;
  scheduledEventId: number;
  result?: number;
}

export interface ReplaySnapshot {
  status: WorkerStatus;
  events: HistoryEvent[];
  nextEventId: number;
  code: CodeProgress;
  commands: Command[];
  comparison: ComparisonRow[];
  activities: ActivityView[];
  eventLog: string[];
  nondeterminism: boolean;
  nondeterminismError: string | null;
  // sim-time clock for activity completion scheduling (modeled, not wall clock)
  clockMs: number;
  // count of REAL activity executions; never increments during the replaying phase
  // (replay sources results from history). Live continuation past the history edge does.
  activityExecCount: number;
}

export interface ReplaySim {
  step(dtMs: number): void;
  start(): void;
  crashWorker(): void;
  startReplay(): void;
  replayStep(): void;
  replayAll(): void;
  setNondeterminism(on: boolean): void;
  reset(): void;
  snapshot(): ReplaySnapshot;
}

export const SIMPLIFICATIONS: readonly string[] = [
  "One hardcoded workflow definition (processOrder); no task queues, no workflow versioning, no child workflows or signals.",
  "Sticky-cache reality: a real worker keeps the workflow's in-memory state in a sticky cache and replays the FULL history only on a cache miss (new worker, eviction, deploy). Here every replay is a full replay from the first event.",
  "Workflow-task batching is simplified to one command per workflow task; real Temporal batches all commands produced before the code next blocks into a single WorkflowTaskCompleted.",
  "Activities complete after a fixed seeded sim-time; no retries, no heartbeats, no activity-task timeouts in the normal path.",
  "On crash the single in-flight activity is modeled as completing server-side (its ActivityTaskCompleted is recorded) rather than timing out — picked for clarity; the other valid outcome (timeout + retry) is noted in prose.",
  "Nondeterminism is MODELED as a context clock that differs between the original run and replay (a stand-in for a naked time.Now()/rand call in workflow code), not a real wall-clock read.",
  "The server's command/event matching is simplified to comparing the command type (and activity/timer identity) against the next command-producing event in history.",
  "Timer duration (sleep 5s) is symbolic: it fires after one sim-time tick rather than a real 5s, since durable timers are server-side and replay-transparent.",
  "Nondeterminism is only detectable when a divergent command is matched against an ALREADY-RECORDED event. Divergence that happens PAST the history edge — e.g., a crash before the branch's command event was written — is indistinguishable from normal forward progress and replays 'cleanly' into live continuation. The viz and prose stage the demo so the injected divergence always lands behind the recorded edge.",
];

const CHARGE_TIMER_ID = "sleep-5s";
const ACTIVITY_DURATION_MS = 1000;
const TIMER_DURATION_MS = 1000;
const BRANCH_THRESHOLD = 100;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A command-producing event is one the workflow code is responsible for emitting:
// ScheduleActivityTask -> ActivityTaskScheduled, StartTimer -> TimerStarted,
// CompleteWorkflowExecution -> WorkflowExecutionCompleted. Replay matches the code's
// emitted commands against exactly these events, in order.
const COMMAND_EVENT_TYPES: ReadonlySet<EventType> = new Set<EventType>([
  "ActivityTaskScheduled",
  "TimerStarted",
  "WorkflowExecutionCompleted",
]);

function commandToEventType(c: CommandType): EventType {
  switch (c) {
    case "ScheduleActivityTask":
      return "ActivityTaskScheduled";
    case "StartTimer":
      return "TimerStarted";
    case "CompleteWorkflowExecution":
      return "WorkflowExecutionCompleted";
  }
}

function describeCommand(c: Command): string {
  if (c.type === "ScheduleActivityTask") return `ScheduleActivityTask(${c.activity})`;
  if (c.type === "StartTimer") return `StartTimer(${c.timerId})`;
  return "CompleteWorkflowExecution";
}

function describeEvent(e: HistoryEvent): string {
  if (e.type === "ActivityTaskScheduled") return `ActivityTaskScheduled(${e.activity})`;
  if (e.type === "TimerStarted") return `TimerStarted(${e.timerId})`;
  return e.type;
}

// The workflow definition, expressed as a generator of commands. The driver advances
// it one blocking command at a time. `ctx` supplies activity results — from a fresh
// run during the original execution, or from recorded history during replay. The
// `clock` is the modeled nondeterminism source: when injection is on, the branch
// consults it instead of the recorded chargeCard amount, so the original run and the
// replay (different clock values) can diverge.
interface WorkflowCtx {
  clock: () => number;
  nondeterminism: boolean;
  onStep: (step: WorkflowStepId, line: number, amount: number | null, reserved: boolean | null) => void;
}

function* processOrder(ctx: WorkflowCtx): Generator<Command, void, number> {
  ctx.onStep("start", 1, null, null);

  // line 2: amount = yield chargeCard() — the resumed value is the activity result,
  // produced fresh on the original run and replayed from history on replay.
  ctx.onStep("chargeCard", 2, null, null);
  const amount = yield { type: "ScheduleActivityTask", activity: "chargeCard" };

  // line 3: branch decision
  let reserved = false;
  // Determinism hazard modeled here: with nondeterminism ON the workflow consults a
  // wall-clock-ish value (ctx.clock) instead of the recorded amount to pick the branch.
  const branchValue = ctx.nondeterminism ? ctx.clock() : amount;
  ctx.onStep("branch", 3, amount, reserved);
  if (branchValue > BRANCH_THRESHOLD) {
    ctx.onStep("reserveInventory", 4, amount, reserved);
    yield { type: "ScheduleActivityTask", activity: "reserveInventory" };
    reserved = true;
    ctx.onStep("reserveInventory", 4, amount, reserved);
  }

  // line 5: timer sleep(5s)
  ctx.onStep("timer", 5, amount, reserved);
  yield { type: "StartTimer", timerId: CHARGE_TIMER_ID };

  // line 6: sendEmail()
  ctx.onStep("sendEmail", 6, amount, reserved);
  yield { type: "ScheduleActivityTask", activity: "sendEmail" };

  // line 7: complete
  ctx.onStep("complete", 7, amount, reserved);
  yield { type: "CompleteWorkflowExecution" };

  ctx.onStep("done", 8, amount, reserved);
}

export function createReplaySim(seed: number): ReplaySim {
  let rng = mulberry32(seed);

  let status: WorkerStatus;
  let events: HistoryEvent[];
  let nextEventId: number;
  let clockMs: number;
  let eventLog: string[];
  let nondeterminism: boolean;
  let nondeterminismError: string | null;

  // original-run worker state
  let code: CodeProgress;
  let pendingCommands: Command[];
  let activities: ActivityView[];
  // the live generator running the original execution
  let gen: Generator<Command, void, number> | null;
  // the command the generator is currently blocked on, awaiting an event/result
  let blockedCommand: Command | null;
  // recorded result of the last chargeCard, drives the live branch
  let recordedAmounts: Map<ActivityName, number>;
  // an activity scheduled and awaiting completion in sim-time
  let inFlight: { activity: ActivityName; result: number; remainingMs: number } | null;
  // a timer awaiting fire in sim-time
  let pendingTimer: { timerId: string; remainingMs: number } | null;

  // replay-specific state
  let comparison: ComparisonRow[];
  let replayGen: Generator<Command, void, number> | null;
  // index into the recorded command-producing events the replay matches against
  let replayEventCursor: number;
  let replayBlocked: Command | null;
  let replayDone: boolean;
  // the activity-execution counter; must NOT change during replay
  let activityExecCount: number;
  // context clock counters: distinct between original and replay contexts
  let originalClockTicks: number;
  let replayClockTicks: number;

  function init(): void {
    // Re-seed the RNG so a reset sim reproduces the same trajectory as a fresh
    // createReplaySim(seed) call — the advanced RNG state from a prior run must
    // not carry over into the restarted simulation.
    rng = mulberry32(seed);
    status = "idle";
    events = [];
    nextEventId = 1;
    clockMs = 0;
    eventLog = [];
    nondeterminism = false;
    nondeterminismError = null;
    code = { step: "start", line: 0, amount: null, reserved: null };
    pendingCommands = [];
    activities = [];
    gen = null;
    blockedCommand = null;
    recordedAmounts = new Map();
    inFlight = null;
    pendingTimer = null;
    comparison = [];
    replayGen = null;
    replayEventCursor = 0;
    replayBlocked = null;
    replayDone = false;
    activityExecCount = 0;
    originalClockTicks = 0;
    replayClockTicks = 0;
  }

  function appendEvent(e: Omit<HistoryEvent, "eventId" | "replayCursor">): HistoryEvent {
    const ev: HistoryEvent = { ...e, eventId: nextEventId++, replayCursor: false };
    events.push(ev);
    return ev;
  }

  function setCode(step: WorkflowStepId, line: number, amount: number | null, reserved: boolean | null): void {
    code = { step, line, amount, reserved };
  }

  // Execute one activity for real: draw a seeded result and record it. This is the
  // only place the activity-execution counter increments — replay must never reach it.
  function executeActivity(activity: ActivityName): number {
    activityExecCount += 1;
    if (activity === "chargeCard") {
      // amounts straddle the branch threshold so the branch is interesting
      return 50 + Math.floor(rng() * 120); // 50..169
    }
    return 1; // reserveInventory / sendEmail: nominal success
  }

  function liveCtx(): WorkflowCtx {
    return {
      clock: () => {
        originalClockTicks += 1;
        // a value that lands on the >threshold branch in the original run
        return BRANCH_THRESHOLD + 50 + originalClockTicks;
      },
      nondeterminism,
      onStep: setCode,
    };
  }

  // Advance the live generator until it blocks on a command (or finishes). The result
  // fed back in is the recorded amount for the just-resolved activity (or 0).
  function pumpLiveGenerator(resumeValue: number): void {
    if (!gen) return;
    const next = gen.next(resumeValue);
    if (next.done) {
      blockedCommand = null;
      return;
    }
    blockedCommand = next.value;
    pendingCommands = [next.value];
  }

  function doStart(): void {
    if (status !== "idle") return;
    status = "running";
    appendEvent({ type: "WorkflowExecutionStarted", payload: "processOrder(order)" });
    appendEvent({ type: "WorkflowTaskScheduled", payload: "first workflow task" });
    appendEvent({ type: "WorkflowTaskStarted", payload: "worker picks up task" });
    eventLog.push("worker started — executing processOrder from the top");

    gen = processOrder(liveCtx());
    // prime the generator to its first command
    const first = gen.next(0 as unknown as number);
    if (!first.done) {
      blockedCommand = first.value;
      pendingCommands = [first.value];
      emitLiveCommand(first.value);
    }
  }

  // Emit a command from the live worker: record the command-producing event(s) and
  // start any sim-time work (activity execution, timer) the command kicks off.
  function emitLiveCommand(cmd: Command): void {
    appendEvent({ type: "WorkflowTaskCompleted", payload: `commands: ${describeCommand(cmd)}` });
    eventLog.push(`worker emitted ${describeCommand(cmd)}`);

    if (cmd.type === "ScheduleActivityTask" && cmd.activity) {
      const scheduled = appendEvent({
        type: "ActivityTaskScheduled",
        payload: `${cmd.activity}`,
        activity: cmd.activity,
      });
      const result = executeActivity(cmd.activity);
      recordedAmounts.set(cmd.activity, result);
      activities.push({
        activity: cmd.activity,
        state: "scheduled",
        scheduledEventId: scheduled.eventId,
        result,
      });
      inFlight = { activity: cmd.activity, result, remainingMs: ACTIVITY_DURATION_MS };
    } else if (cmd.type === "StartTimer" && cmd.timerId) {
      appendEvent({ type: "TimerStarted", payload: `${cmd.timerId}`, timerId: cmd.timerId });
      pendingTimer = { timerId: cmd.timerId, remainingMs: TIMER_DURATION_MS };
    } else if (cmd.type === "CompleteWorkflowExecution") {
      appendEvent({ type: "WorkflowExecutionCompleted", payload: "result: ok" });
      eventLog.push("workflow completed");
      status = "completed";
      blockedCommand = null;
      pendingCommands = [];
    }
  }

  function completeInFlightActivity(): void {
    if (!inFlight) return;
    const act = inFlight;
    const view = activities.find((a) => a.activity === act.activity && a.state !== "completed");
    appendEvent({
      type: "ActivityTaskStarted",
      payload: `${act.activity}`,
      activity: act.activity,
    });
    appendEvent({
      type: "ActivityTaskCompleted",
      payload: `${act.activity} -> ${act.result}`,
      activity: act.activity,
      result: act.result,
    });
    if (view) {
      view.state = "completed";
      view.result = act.result;
    }
    eventLog.push(`activity ${act.activity} completed with ${act.result}`);
    inFlight = null;

    // feed the recorded result back into the workflow and let it emit its next command
    schedulePostTaskEvents();
    pumpLiveGenerator(act.result);
    if (!blockedCommand) {
      // generator finished without another command (shouldn't happen before complete)
      return;
    }
    emitLiveCommand(blockedCommand);
  }

  function fireTimer(): void {
    if (!pendingTimer) return;
    const t = pendingTimer;
    appendEvent({ type: "TimerFired", payload: `${t.timerId}`, timerId: t.timerId });
    eventLog.push(`timer ${t.timerId} fired`);
    pendingTimer = null;

    schedulePostTaskEvents();
    pumpLiveGenerator(0);
    if (blockedCommand) emitLiveCommand(blockedCommand);
  }

  // A new workflow task is scheduled+started each time the workflow is woken by an
  // activity completion or timer firing.
  function schedulePostTaskEvents(): void {
    appendEvent({ type: "WorkflowTaskScheduled", payload: "woken by event" });
    appendEvent({ type: "WorkflowTaskStarted", payload: "worker resumes" });
  }

  function doStep(dtMs: number): void {
    if (dtMs <= 0) return;
    clockMs += dtMs;
    if (status !== "running") return;
    // advance whichever single piece of sim-time work is outstanding
    if (inFlight) {
      inFlight.remainingMs -= dtMs;
      if (inFlight.remainingMs <= 0) completeInFlightActivity();
      return;
    }
    if (pendingTimer) {
      pendingTimer.remainingMs -= dtMs;
      if (pendingTimer.remainingMs <= 0) fireTimer();
    }
  }

  function doCrashWorker(): void {
    if (status !== "running") return;
    // In-flight activity completes server-side and records its event (simplification).
    if (inFlight) {
      const act = inFlight;
      const view = activities.find((a) => a.activity === act.activity && a.state !== "completed");
      appendEvent({
        type: "ActivityTaskStarted",
        payload: `${act.activity}`,
        activity: act.activity,
      });
      appendEvent({
        type: "ActivityTaskCompleted",
        payload: `${act.activity} -> ${act.result} (recorded server-side)`,
        activity: act.activity,
        result: act.result,
      });
      if (view) {
        view.state = "completed";
        view.result = act.result;
      }
      eventLog.push(`worker crashed; in-flight ${act.activity} still recorded server-side as ${act.result}`);
      inFlight = null;
    } else {
      eventLog.push("worker crashed — in-memory workflow state lost; history intact");
    }
    // worker's in-memory state is gone
    status = "crashed";
    gen = null;
    blockedCommand = null;
    pendingCommands = [];
    pendingTimer = null;
    code = { step: "start", line: 0, amount: null, reserved: null };
  }

  function replayCtx(): WorkflowCtx {
    return {
      clock: () => {
        replayClockTicks += 1;
        // distinct from the original-run clock: lands on the <=threshold branch,
        // so an injected nondeterministic branch diverges from the recorded path.
        return BRANCH_THRESHOLD - 50 - replayClockTicks;
      },
      nondeterminism,
      onStep: setCode,
    };
  }

  // Recorded command-producing events in history order. These are what the replay's
  // emitted commands are matched against, one at a time.
  function recordedCommandEvents(): HistoryEvent[] {
    return events.filter((e) => COMMAND_EVENT_TYPES.has(e.type));
  }

  function clearReplayCursors(): void {
    for (const e of events) e.replayCursor = false;
  }

  function doStartReplay(): void {
    if (status !== "crashed") return;
    status = "replaying";
    comparison = [];
    replayEventCursor = 0;
    replayBlocked = null;
    replayDone = false;
    replayClockTicks = 0;
    nondeterminismError = null;
    clearReplayCursors();
    // a fresh worker reconstructs local state from scratch
    activities = activities.map((a) => ({ ...a }));
    code = { step: "start", line: 0, amount: null, reserved: null };
    recordedAmounts = recoverRecordedAmounts();
    eventLog.push("replay start — fresh worker re-executing processOrder against history");

    replayGen = processOrder(replayCtx());
    const first = replayGen.next(0 as unknown as number);
    if (!first.done) replayBlocked = first.value;
    else replayDone = true;
  }

  // Rebuild the recorded-results map purely from history (the source of truth) so the
  // replay never depends on the crashed worker's lost in-memory state.
  function recoverRecordedAmounts(): Map<ActivityName, number> {
    const m = new Map<ActivityName, number>();
    for (const e of events) {
      if (e.type === "ActivityTaskCompleted" && e.activity && e.result !== undefined) {
        m.set(e.activity, e.result);
      }
    }
    return m;
  }

  // Advance the replay by one matched command. Returns when it has matched a command
  // against history, hit a mismatch (nondeterminism), or exhausted history.
  function doReplayStep(): void {
    if (status === "crashed") {
      doStartReplay();
      return;
    }
    if (status !== "replaying") return;
    if (replayDone || !replayBlocked) {
      finishReplay();
      return;
    }

    const emitted = replayBlocked;
    const recordedEvents = recordedCommandEvents();

    if (replayEventCursor >= recordedEvents.length) {
      // history exhausted — continue live execution from here
      continueLive(emitted);
      return;
    }

    const recordedEvent = recordedEvents[replayEventCursor];
    const emittedType = commandToEventType(emitted.type);
    const sameType = emittedType === recordedEvent.type;
    const sameIdentity =
      emitted.type === "ScheduleActivityTask"
        ? emitted.activity === recordedEvent.activity
        : emitted.type === "StartTimer"
          ? emitted.timerId === recordedEvent.timerId
          : true;
    const matched = sameType && sameIdentity;

    comparison.push({
      index: replayEventCursor,
      recorded: describeEvent(recordedEvent),
      emitted: describeCommand(emitted),
      outcome: matched ? "match" : "mismatch",
    });
    recordedEvent.replayCursor = true;

    if (!matched) {
      // Real Temporal: the workflow task FAILS with a nondeterminism error and would
      // retry forever; history is not modified, workflow does not complete.
      nondeterminismError = `nondeterminism error: replay emitted ${describeCommand(
        emitted,
      )} but history expected ${describeEvent(recordedEvent)} (eventId ${recordedEvent.eventId})`;
      eventLog.push(nondeterminismError);
      eventLog.push("workflow task failed — will retry; workflow cannot make progress");
      status = "failed-nondeterminism";
      replayGen = null;
      replayBlocked = null;
      return;
    }

    eventLog.push(`replay matched ${describeCommand(emitted)} against history eventId ${recordedEvent.eventId}`);
    replayEventCursor += 1;

    // A command that started a durable operation (timer / activity) can only advance
    // the workflow once its COMPLETION event is in history. The completion was recorded
    // by the server, so on replay we feed the recorded result back. If the completion
    // is NOT in history, the operation is still outstanding at the history edge: the
    // workflow blocks and live execution must drive it to completion.
    const completion = completionEventFor(emitted, recordedEvent.eventId);
    if ((emitted.type === "ScheduleActivityTask" || emitted.type === "StartTimer") && !completion) {
      continueOutstanding(emitted);
      return;
    }

    // feed the recorded result back (chargeCard -> recorded amount, not a fresh draw)
    const resume =
      emitted.type === "ScheduleActivityTask" && emitted.activity ? (recordedAmounts.get(emitted.activity) ?? 0) : 0;
    const next = replayGen!.next(resume);
    if (next.done) {
      replayBlocked = null;
      replayDone = true;
      finishReplay();
    } else {
      replayBlocked = next.value;
    }
  }

  // The completion event in history for a just-matched command (TimerFired for a timer,
  // ActivityTaskCompleted for an activity), searched after the command's own eventId.
  function completionEventFor(cmd: Command, afterEventId: number): HistoryEvent | null {
    if (cmd.type === "StartTimer") {
      return (
        events.find((e) => e.type === "TimerFired" && e.timerId === cmd.timerId && e.eventId > afterEventId) ?? null
      );
    }
    if (cmd.type === "ScheduleActivityTask") {
      return (
        events.find(
          (e) => e.type === "ActivityTaskCompleted" && e.activity === cmd.activity && e.eventId > afterEventId,
        ) ?? null
      );
    }
    return null;
  }

  // History is exhausted with NO outstanding operation: the replayed code is caught up
  // and runs live. The pending command becomes a real command emitted against the
  // now-live workflow.
  function continueLive(emitted: Command): void {
    eventLog.push(`history exhausted — continuing live from ${describeCommand(emitted)}`);
    status = "running";
    gen = replayGen;
    replayGen = null;
    blockedCommand = emitted;
    pendingCommands = [emitted];
    emitLiveCommand(emitted);
  }

  // The just-matched command started a timer/activity whose completion never made it
  // into history (the worker crashed before it fired). On replay the workflow is blocked
  // on this outstanding operation: switch to live and install the pending op so doStep
  // drives it to completion, then resumes the workflow.
  function continueOutstanding(emitted: Command): void {
    eventLog.push(`history exhausted at outstanding ${describeCommand(emitted)} — resuming live, awaiting completion`);
    status = "running";
    gen = replayGen;
    replayGen = null;
    blockedCommand = null;
    pendingCommands = [];
    if (emitted.type === "StartTimer" && emitted.timerId) {
      pendingTimer = { timerId: emitted.timerId, remainingMs: TIMER_DURATION_MS };
    } else if (emitted.type === "ScheduleActivityTask" && emitted.activity) {
      const result = executeActivity(emitted.activity);
      recordedAmounts.set(emitted.activity, result);
      const existing = activities.find((a) => a.activity === emitted.activity && a.state !== "completed");
      if (!existing) {
        const scheduled = events.find((e) => e.type === "ActivityTaskScheduled" && e.activity === emitted.activity);
        activities.push({
          activity: emitted.activity,
          state: "scheduled",
          scheduledEventId: scheduled?.eventId ?? -1,
          result,
        });
      }
      inFlight = { activity: emitted.activity, result, remainingMs: ACTIVITY_DURATION_MS };
    }
  }

  function finishReplay(): void {
    if (status === "failed-nondeterminism") return;
    if (replayDone && status === "replaying") {
      // The whole workflow was already complete in history; replay confirmed it.
      status = "completed";
      eventLog.push("replay complete — reconstructed state matches recorded history");
    }
  }

  function doReplayAll(): void {
    if (status === "crashed") doStartReplay();
    let guard = events.length * 2 + 16;
    while (status === "replaying" && guard-- > 0) {
      doReplayStep();
    }
    // if we transitioned to "running" (live continuation), drive sim-time to finish
    let liveGuard = 64;
    while (status === "running" && liveGuard-- > 0) {
      doStep(ACTIVITY_DURATION_MS + TIMER_DURATION_MS);
    }
  }

  function snapshotImpl(): ReplaySnapshot {
    return {
      status,
      events: events.map((e) => ({ ...e })),
      nextEventId,
      code: { ...code },
      commands: pendingCommands.map((c) => ({ ...c })),
      comparison: comparison.map((r) => ({ ...r })),
      activities: activities.map((a) => ({ ...a })),
      eventLog: [...eventLog],
      nondeterminism,
      nondeterminismError,
      clockMs,
      activityExecCount,
    };
  }

  init();

  return {
    step: doStep,
    start: doStart,
    crashWorker: doCrashWorker,
    startReplay: doStartReplay,
    replayStep: doReplayStep,
    replayAll: doReplayAll,
    setNondeterminism(on: boolean) {
      nondeterminism = on;
    },
    reset: init,
    snapshot: snapshotImpl,
  };
}
