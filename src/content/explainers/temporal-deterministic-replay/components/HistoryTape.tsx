import { useState } from "react";
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
    return "color-mix(in srgb, var(--color-entity) 8%, transparent)";
  }
  if (type === "TimerStarted" || type === "TimerFired") {
    return "color-mix(in srgb, var(--color-pending) 8%, transparent)";
  }
  if (type === "WorkflowExecutionCompleted") {
    return "color-mix(in srgb, var(--color-ok) 8%, transparent)";
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

function pinDetail(e: HistoryEvent): string {
  const activityLabel = e.activity ?? "";
  const resultSuffix =
    e.result !== undefined ? ` → ${e.result} (recorded server-side)` : "";
  return `#${e.eventId} ${e.type}${activityLabel ? ` — ${activityLabel}` : ""}${resultSuffix}`;
}

interface HistoryTapeProps {
  events: HistoryEvent[];
  reducedMotion: boolean;
}

export function HistoryTape({ events, reducedMotion }: HistoryTapeProps) {
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);

  const pinnedEvent = selectedEventId !== null ? events.find((e) => e.eventId === selectedEventId) ?? null : null;

  function handleSelect(eventId: number) {
    setSelectedEventId((prev) => (prev === eventId ? null : eventId));
  }

  return (
    <div>
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
            const isSelected = selectedEventId === e.eventId;
            const color = isCursor ? "var(--color-paper)" : eventColor(e.type);
            const bg = eventBg(e.type, isCursor);
            return (
              <button
                key={e.eventId}
                aria-pressed={isSelected}
                onClick={() => handleSelect(e.eventId)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    handleSelect(e.eventId);
                  }
                }}
                style={{
                  flexShrink: 0,
                  padding: "3px 6px",
                  border: isSelected
                    ? "2px solid var(--color-entity)"
                    : isCursor
                      ? "2px solid var(--color-ink)"
                      : "1px solid var(--color-rule)",
                  borderRadius: 3,
                  background: bg,
                  color,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  lineHeight: 1.4,
                  position: "relative",
                  transition: reducedMotion ? "none" : "border-color 200ms ease, background 200ms ease",
                  minWidth: 44,
                  cursor: "pointer",
                  textAlign: "left",
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
              </button>
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

      {pinnedEvent && (
        <div
          style={{
            marginTop: 4,
            padding: "4px 8px",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-ink)",
            background: "color-mix(in srgb, var(--color-entity) 8%, transparent)",
            border: "1px solid var(--color-rule)",
            borderRadius: 3,
            whiteSpace: "pre",
          }}
        >
          {pinDetail(pinnedEvent)}
        </div>
      )}
    </div>
  );
}
