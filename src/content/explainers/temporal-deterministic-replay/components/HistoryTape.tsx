import type { HistoryEvent, EventType } from "../sim/replaySim";

const EVENT_ABBREV: Record<EventType, string> = {
  WorkflowExecutionStarted: "WFStarted",
  WorkflowTaskScheduled: "WTSched",
  WorkflowTaskStarted: "WTStart",
  WorkflowTaskCompleted: "WTComp",
  ActivityTaskScheduled: "ActSched",
  ActivityTaskStarted: "ActStart",
  ActivityTaskCompleted: "ActComp",
  TimerStarted: "TimerStart",
  TimerFired: "TimerFired",
  WorkflowExecutionCompleted: "WFComp",
};

function eventColor(type: EventType): string {
  if (type === "ActivityTaskScheduled" || type === "ActivityTaskStarted" || type === "ActivityTaskCompleted") {
    return "var(--color-entity)";
  }
  if (type === "TimerStarted" || type === "TimerFired") {
    return "var(--color-pending)";
  }
  if (type === "WorkflowExecutionCompleted") {
    return "var(--color-ok)";
  }
  return "var(--color-muted)";
}

function eventBg(type: EventType, isCursor: boolean): string {
  if (isCursor) return "var(--color-ink)";
  if (type === "ActivityTaskScheduled" || type === "ActivityTaskStarted" || type === "ActivityTaskCompleted") {
    return "rgba(59,130,246,0.08)";
  }
  if (type === "TimerStarted" || type === "TimerFired") {
    return "rgba(245,158,11,0.08)";
  }
  if (type === "WorkflowExecutionCompleted") {
    return "rgba(34,197,94,0.08)";
  }
  return "var(--color-raised)";
}

function abbrev(e: HistoryEvent): string {
  const base = EVENT_ABBREV[e.type];
  if (e.type === "ActivityTaskScheduled" && e.activity) return `ActSched(${e.activity})`;
  if (e.type === "ActivityTaskCompleted" && e.result !== undefined) return `ActComp(=${e.result})`;
  if (e.type === "ActivityTaskCompleted") return `ActComp`;
  return base;
}

interface HistoryTapeProps {
  events: HistoryEvent[];
  reducedMotion: boolean;
}

export function HistoryTape({ events, reducedMotion }: HistoryTapeProps) {
  return (
    <div
      style={{
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        paddingBottom: 4,
      }}
      role="region"
      aria-label="Event history tape"
    >
      <div
        style={{
          display: "flex",
          gap: 4,
          minWidth: "min-content",
          padding: "2px 2px 4px",
        }}
      >
        {events.map((e) => {
          const isCursor = e.replayCursor;
          const color = isCursor ? "var(--color-paper)" : eventColor(e.type);
          const bg = eventBg(e.type, isCursor);
          return (
            <div
              key={e.eventId}
              title={`eventId=${e.eventId} type=${e.type} payload=${e.payload}`}
              style={{
                flexShrink: 0,
                padding: "3px 6px",
                border: isCursor ? "2px solid var(--color-ink)" : "1px solid var(--color-rule)",
                borderRadius: 3,
                background: bg,
                color,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                lineHeight: 1.4,
                position: "relative",
                transition: reducedMotion ? "none" : "border-color 200ms ease, background 200ms ease",
                minWidth: 44,
                cursor: "default",
              }}
            >
              <div style={{ color: "var(--color-muted)", fontSize: 10 }}>#{e.eventId}</div>
              <div style={{ fontWeight: isCursor ? 700 : 400 }}>{abbrev(e)}</div>
              {isCursor && (
                <div
                  style={{
                    fontSize: 9,
                    color: "var(--color-paper)",
                    marginTop: 1,
                    opacity: 0.85,
                  }}
                >
                  ▸ replaying
                </div>
              )}
            </div>
          );
        })}
        {events.length === 0 && (
          <div
            style={{
              color: "var(--color-muted)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              padding: "4px 8px",
            }}
          >
            (no events yet — press Run)
          </div>
        )}
      </div>
    </div>
  );
}
