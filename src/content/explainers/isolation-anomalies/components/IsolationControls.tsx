import type { IsolationLevel, IsolationSnapshot, ScenarioId } from "../sim/isolationSim";
import { LEVEL_LABELS, SCENARIO_ORDER } from "../sim/isolationSim";
import { VizButton, VizToggle, SpeedControl, PlayPauseOrStep, BTN_BASE } from "../../../../lib/viz";

const SCENARIO_LABEL: Record<ScenarioId, string> = {
  "lost-update": "Lost update",
  "non-repeatable-read": "Non-repeatable read",
  phantom: "Phantom read",
  "write-skew": "Write skew",
};

const LEVELS: IsolationLevel[] = ["RC", "RR", "SER"];

const SEP: React.CSSProperties = {
  width: 1,
  height: 28,
  background: "var(--color-rule)",
  margin: "0 2px",
  flexShrink: 0,
};

interface Props {
  snap: IsolationSnapshot;
  paused: boolean;
  speed: number;
  reducedMotion: boolean;
  onSetScenario: (id: ScenarioId) => void;
  onSetLevel: (l: IsolationLevel) => void;
  onToggleAutoPlay: () => void;
  onTogglePause: () => void;
  onStepScript: () => void;
  onReset: () => void;
  onSpeedChange: (s: number) => void;
}

export function IsolationControls({
  snap,
  paused,
  speed,
  reducedMotion,
  onSetScenario,
  onSetLevel,
  onToggleAutoPlay,
  onTogglePause,
  onStepScript,
  onReset,
  onSpeedChange,
}: Props) {
  return (
    <div style={{ fontFamily: "var(--font-mono)" }}>
      {/* Scenario tabs */}
      <div role="tablist" aria-label="anomaly scenario" style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {SCENARIO_ORDER.map((id) => {
          const active = snap.scenarioId === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => onSetScenario(id)}
              style={{
                ...BTN_BASE,
                minHeight: 36,
                fontSize: 11,
                background: active ? "var(--color-ink)" : "var(--color-raised)",
                color: active ? "var(--color-raised)" : "var(--color-muted)",
                fontWeight: active ? 600 : 400,
              }}
              title={`Switch to the ${SCENARIO_LABEL[id]} scenario`}
            >
              {SCENARIO_LABEL[id]}
            </button>
          );
        })}
      </div>

      {/* Isolation dial + action bar */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          padding: "10px 0 0",
        }}
      >
        <span style={{ fontSize: 10, color: "var(--color-muted)" }}>ISOLATION</span>
        <div style={{ display: "flex", gap: 0, border: "1px solid var(--color-rule)", borderRadius: 3, overflow: "hidden" }}>
          {LEVELS.map((l) => {
            const active = snap.level === l;
            return (
              <button
                key={l}
                onClick={() => onSetLevel(l)}
                aria-pressed={active}
                style={{
                  ...BTN_BASE,
                  border: "none",
                  borderRadius: 0,
                  minWidth: 0,
                  padding: "6px 12px",
                  background: active ? "var(--color-entity)" : "var(--color-raised)",
                  color: active ? "var(--color-paper)" : "var(--color-muted)",
                  fontWeight: active ? 600 : 400,
                }}
                title={LEVEL_LABELS[l]}
              >
                {l}
              </button>
            );
          })}
        </div>
        <span style={{ fontSize: 10, color: "var(--color-ink)" }}>{LEVEL_LABELS[snap.level]}</span>

        <div style={SEP} />

        <VizToggle
          pressed={snap.autoPlay}
          label={snap.autoPlay ? "auto-running" : "auto-run"}
          disabled={snap.scriptDone}
          onClick={onToggleAutoPlay}
          title="Play the scripted interleaving that triggers this anomaly"
        />
        {!reducedMotion && snap.autoPlay && (
          <PlayPauseOrStep paused={paused} reducedMotion={false} onTogglePause={onTogglePause} onStep={onStepScript} />
        )}
        <VizButton
          onClick={onStepScript}
          disabled={snap.scriptDone}
          title="Advance the scripted interleaving by one statement"
        >
          Step script
        </VizButton>
        <VizButton onClick={onReset} title="Restart this scenario">
          Reset
        </VizButton>
        {!reducedMotion && <SpeedControl speed={speed} onSpeedChange={onSpeedChange} />}
      </div>
    </div>
  );
}
