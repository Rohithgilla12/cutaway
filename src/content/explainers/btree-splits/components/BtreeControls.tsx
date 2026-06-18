import type { BtreeSnapshot, InsertMode } from "../sim/btreeSim";
import { VizButton, VizToggle, SpeedControl, PlayPauseOrStep, BTN_BASE } from "../../../../lib/viz";

const SEP: React.CSSProperties = {
  width: 1,
  height: 28,
  background: "var(--color-rule)",
  margin: "0 2px",
  flexShrink: 0,
};

interface Props {
  snap: BtreeSnapshot;
  paused: boolean;
  speed: number;
  reducedMotion: boolean;
  onInsert: () => void;
  onSetMode: (m: InsertMode) => void;
  onSetFillfactor: (ff: number) => void;
  onToggleWorkload: () => void;
  onTogglePause: () => void;
  onStep: () => void;
  onReset: () => void;
  onSpeedChange: (s: number) => void;
}

export function BtreeControls({
  snap,
  paused,
  speed,
  reducedMotion,
  onInsert,
  onSetMode,
  onSetFillfactor,
  onToggleWorkload,
  onTogglePause,
  onStep,
  onReset,
  onSpeedChange,
}: Props) {
  const modes: InsertMode[] = ["sequential", "random"];
  return (
    <div style={{ fontFamily: "var(--font-mono)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 10, color: "var(--color-muted)" }}>KEYS</span>
        <div style={{ display: "flex", border: "1px solid var(--color-rule)", borderRadius: 3, overflow: "hidden" }}>
          {modes.map((m) => {
            const active = snap.mode === m;
            return (
              <button
                key={m}
                onClick={() => onSetMode(m)}
                aria-pressed={active}
                style={{
                  ...BTN_BASE,
                  border: "none",
                  borderRadius: 0,
                  minWidth: 0,
                  padding: "6px 12px",
                  background: active ? "var(--color-ink)" : "var(--color-raised)",
                  color: active ? "var(--color-raised)" : "var(--color-muted)",
                  fontWeight: active ? 600 : 400,
                }}
                title={m === "sequential" ? "Append monotonically increasing keys (like bigserial)" : "Insert random keys (like a UUIDv4)"}
              >
                {m === "sequential" ? "sequential" : "random (UUID-like)"}
              </button>
            );
          })}
        </div>

        <VizButton variant="primary" onClick={onInsert} disabled={snap.full} title="Insert one key in the current mode">
          Insert key
        </VizButton>
        <VizToggle
          pressed={snap.workload}
          label={`stream ${snap.workload ? "on" : "off"}`}
          disabled={snap.full}
          onClick={onToggleWorkload}
          title="Insert keys continuously"
        />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 8 }}>
        <label style={{ fontSize: 10, color: "var(--color-muted)", display: "flex", alignItems: "center", gap: 6 }}>
          fillfactor {snap.fillfactor}%
          <input
            type="range"
            min={50}
            max={100}
            step={10}
            value={snap.fillfactor}
            onChange={(e) => onSetFillfactor(Number(e.target.value))}
            style={{ width: 110 }}
            aria-label="leaf fillfactor"
          />
        </label>

        <div style={SEP} />

        <PlayPauseOrStep paused={paused} reducedMotion={reducedMotion} onTogglePause={onTogglePause} onStep={onStep} />
        <VizButton onClick={onReset} title="Empty the tree">
          Reset
        </VizButton>
        {!reducedMotion && <SpeedControl speed={speed} onSpeedChange={onSpeedChange} />}
      </div>
    </div>
  );
}
