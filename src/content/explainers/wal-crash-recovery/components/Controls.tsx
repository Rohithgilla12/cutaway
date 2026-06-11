import type { WalSnapshot } from "../sim/walSim";

interface Props {
  snap: WalSnapshot;
  paused: boolean;
  speed: number;
  reducedMotion: boolean;
  onCommit: () => void;
  onCrash: () => void;
  onRecoverStep: () => void;
  onRecoverAll: () => void;
  onCheckpoint: () => void;
  onToggleLoad: () => void;
  onToggleFsync: () => void;
  onTogglePause: () => void;
  onStep: () => void;
  onReset: () => void;
  onSpeedChange: (s: number) => void;
}

const BTN_BASE: React.CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  padding: "6px 14px",
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  cursor: "pointer",
  border: "1px solid var(--color-rule)",
  borderRadius: 3,
  background: "var(--color-raised)",
  color: "var(--color-ink)",
  letterSpacing: "0.02em",
};

const BTN_PRIMARY: React.CSSProperties = {
  ...BTN_BASE,
  background: "var(--color-ink)",
  color: "var(--color-raised)",
  border: "1px solid var(--color-ink)",
};

const BTN_DANGER: React.CSSProperties = {
  ...BTN_BASE,
  background: "var(--color-danger)",
  color: "#fff",
  border: "1px solid var(--color-danger)",
};

const BTN_DISABLED: React.CSSProperties = {
  ...BTN_BASE,
  opacity: 0.45,
  cursor: "default",
  color: "var(--color-muted)",
};

export function Controls({
  snap,
  paused,
  speed,
  reducedMotion,
  onCommit,
  onCrash,
  onRecoverStep,
  onRecoverAll,
  onCheckpoint,
  onToggleLoad,
  onToggleFsync,
  onTogglePause,
  onStep,
  onReset,
  onSpeedChange,
}: Props) {
  const running = snap.phase === "running";
  const crashed = snap.phase === "crashed";
  const recovering = snap.phase === "recovering";
  const recovered = snap.phase === "recovered";
  const inRecovery = crashed || recovering || recovered;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        padding: "10px 4px 4px",
        fontFamily: "var(--font-mono)",
        alignItems: "center",
      }}
    >
      <button
        style={running ? BTN_PRIMARY : BTN_DISABLED}
        disabled={!running}
        onClick={onCommit}
        title="Append a transaction and flush"
      >
        Commit
      </button>

      <button
        style={BTN_DANGER}
        onClick={onCrash}
        title="Simulate a process crash"
      >
        Crash
      </button>

      {inRecovery && (
        <button
          style={crashed || recovering ? BTN_PRIMARY : BTN_DISABLED}
          disabled={recovered}
          onClick={onRecoverStep}
          title="Replay the next WAL record"
        >
          Recover step
        </button>
      )}

      {inRecovery && (
        <button
          style={crashed || recovering ? BTN_BASE : BTN_DISABLED}
          disabled={recovered}
          onClick={onRecoverAll}
          title="Replay all remaining WAL records"
        >
          Recover all
        </button>
      )}

      <div
        style={{
          width: 1,
          height: 28,
          background: "var(--color-rule)",
          margin: "0 2px",
          flexShrink: 0,
        }}
      />

      <button
        style={{
          ...BTN_BASE,
          background: snap.loadOn ? "var(--color-ink)" : "var(--color-raised)",
          color: snap.loadOn ? "var(--color-raised)" : "var(--color-ink)",
        }}
        onClick={onToggleLoad}
        disabled={!running}
        title="Toggle automatic transaction load"
        aria-pressed={snap.loadOn}
      >
        Load {snap.loadOn ? "on" : "off"}
      </button>

      <button
        style={{
          ...BTN_BASE,
          background: snap.fsyncOnCommit ? "var(--color-ink)" : "var(--color-raised)",
          color: snap.fsyncOnCommit ? "var(--color-raised)" : "var(--color-ink)",
        }}
        onClick={onToggleFsync}
        disabled={!running}
        title="Toggle fsync on commit"
        aria-pressed={snap.fsyncOnCommit}
      >
        fsync = {snap.fsyncOnCommit ? "on" : "off"}
      </button>

      <button
        style={running ? BTN_BASE : BTN_DISABLED}
        disabled={!running}
        onClick={onCheckpoint}
        title="Force a checkpoint now"
      >
        Checkpoint
      </button>

      <div
        style={{
          width: 1,
          height: 28,
          background: "var(--color-rule)",
          margin: "0 2px",
          flexShrink: 0,
        }}
      />

      {reducedMotion ? (
        <button style={BTN_BASE} onClick={onStep} title="Advance simulation by 100ms">
          Step
        </button>
      ) : (
        <button
          style={BTN_BASE}
          onClick={onTogglePause}
          title={paused ? "Resume animation" : "Pause animation"}
          aria-pressed={paused}
        >
          {paused ? "▶ Play" : "⏸ Pause"}
        </button>
      )}

      <button style={BTN_BASE} onClick={onReset} title="Reset to initial state">
        Reset
      </button>

      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {([0.5, 1, 2] as const).map((s) => (
          <button
            key={s}
            style={{
              ...BTN_BASE,
              padding: "4px 8px",
              background: speed === s ? "var(--color-ink)" : "var(--color-raised)",
              color: speed === s ? "var(--color-raised)" : "var(--color-muted)",
              fontSize: "11px",
            }}
            onClick={() => onSpeedChange(s)}
            aria-pressed={speed === s}
            title={`Set speed to ${s}×`}
          >
            {s}×
          </button>
        ))}
      </div>
    </div>
  );
}
