import type { WalSnapshot } from "../sim/walSim";
import {
  VizButton,
  VizToggle,
  SpeedControl,
  PlayPauseOrStep,
  BTN_BASE,
  BTN_PRIMARY,
  BTN_DISABLED,
} from "../../../../lib/viz";

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
      <VizButton
        variant={running ? "primary" : "default"}
        disabled={!running}
        onClick={onCommit}
        title="Append a transaction and flush"
        style={running ? BTN_PRIMARY : BTN_DISABLED}
      >
        Commit
      </VizButton>

      <VizButton variant="danger" onClick={onCrash} title="Simulate a process crash">
        Crash
      </VizButton>

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

      <VizToggle
        pressed={snap.loadOn}
        label={`Load ${snap.loadOn ? "on" : "off"}`}
        onClick={onToggleLoad}
        disabled={!running}
        title="Toggle automatic transaction load"
      />

      <VizToggle
        pressed={snap.fsyncOnCommit}
        label={`fsync = ${snap.fsyncOnCommit ? "on" : "off"}`}
        onClick={onToggleFsync}
        disabled={!running}
        title="Toggle fsync on commit"
      />

      <VizButton
        disabled={!running}
        onClick={onCheckpoint}
        title="Force a checkpoint now"
        style={running ? BTN_BASE : BTN_DISABLED}
      >
        Checkpoint
      </VizButton>

      <div
        style={{
          width: 1,
          height: 28,
          background: "var(--color-rule)",
          margin: "0 2px",
          flexShrink: 0,
        }}
      />

      <PlayPauseOrStep paused={paused} reducedMotion={reducedMotion} onTogglePause={onTogglePause} onStep={onStep} />

      <VizButton onClick={onReset} title="Reset to initial state">
        Reset
      </VizButton>

      <SpeedControl speed={speed} onSpeedChange={onSpeedChange} />
    </div>
  );
}
