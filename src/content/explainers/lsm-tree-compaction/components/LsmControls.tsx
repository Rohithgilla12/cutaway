import type { LsmSnapshot } from "../sim/lsmSim";
import { VizButton, VizToggle, SpeedControl, PlayPauseOrStep } from "../../../../lib/viz";

interface Props {
  snap: LsmSnapshot;
  paused: boolean;
  speed: number;
  reducedMotion: boolean;
  onWrite: () => void;
  onDelete: () => void;
  onRead: () => void;
  onFlush: () => void;
  onCompact: () => void;
  onToggleAutoWrite: () => void;
  onToggleAutoFlush: () => void;
  onToggleAutoCompact: () => void;
  onTogglePause: () => void;
  onStep: () => void;
  onReset: () => void;
  onSpeedChange: (s: number) => void;
}

const SEP: React.CSSProperties = {
  width: 1,
  height: 28,
  background: "var(--color-rule)",
  margin: "0 2px",
  flexShrink: 0,
};

export function LsmControls({
  snap,
  paused,
  speed,
  reducedMotion,
  onWrite,
  onDelete,
  onRead,
  onFlush,
  onCompact,
  onToggleAutoWrite,
  onToggleAutoFlush,
  onToggleAutoCompact,
  onTogglePause,
  onStep,
  onReset,
  onSpeedChange,
}: Props) {
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
      <VizButton variant="primary" onClick={onWrite} title="Write a random key/value to memtable">
        Write
      </VizButton>

      <VizButton onClick={onDelete} title="Write a random tombstone to memtable">
        Delete
      </VizButton>

      <VizButton onClick={onRead} title="Read a random key and trace the probe path">
        Read
      </VizButton>

      <VizButton onClick={onFlush} title="Flush memtable to a new L0 SSTable">
        Flush
      </VizButton>

      <VizButton
        variant={snap.compactionPressure ? "primary" : "default"}
        onClick={onCompact}
        title="Compact all L0 files into L1"
      >
        Compact{snap.compactionPressure ? " !" : ""}
      </VizButton>

      <div style={SEP} />

      <VizToggle
        pressed={snap.autoWrite}
        label={`auto-write ${snap.autoWrite ? "on" : "off"}`}
        onClick={onToggleAutoWrite}
        title="Toggle automatic random writes"
      />

      <VizToggle
        pressed={snap.autoFlush}
        label={`auto-flush ${snap.autoFlush ? "on" : "off"}`}
        onClick={onToggleAutoFlush}
        title="Toggle automatic flush when memtable full"
      />

      <VizToggle
        pressed={snap.autoCompact}
        label={`auto-compact ${snap.autoCompact ? "on" : "off"}`}
        onClick={onToggleAutoCompact}
        title="Toggle automatic compaction when L0 >= threshold"
      />

      <div style={SEP} />

      <PlayPauseOrStep paused={paused} reducedMotion={reducedMotion} onTogglePause={onTogglePause} onStep={onStep} />

      <VizButton onClick={onReset} title="Reset simulation to initial state">
        Reset
      </VizButton>

      <SpeedControl speed={speed} onSpeedChange={onSpeedChange} />
    </div>
  );
}
