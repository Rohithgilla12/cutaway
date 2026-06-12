import type { MvccSnapshot } from "../sim/mvccSim";
import { VizButton, VizToggle, SpeedControl, PlayPauseOrStep } from "../../../../lib/viz";

interface Props {
  snap: MvccSnapshot;
  paused: boolean;
  speed: number;
  reducedMotion: boolean;
  onUpdate: () => void;
  onVacuum: () => void;
  onToggleLongTxn: () => void;
  onToggleAutoUpdate: () => void;
  onToggleAutoVacuum: () => void;
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

export function MvccControls({
  snap,
  paused,
  speed,
  reducedMotion,
  onUpdate,
  onVacuum,
  onToggleLongTxn,
  onToggleAutoUpdate,
  onToggleAutoVacuum,
  onTogglePause,
  onStep,
  onReset,
  onSpeedChange,
}: Props) {
  const txnOpen = snap.longTxn !== null;
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
      <VizButton variant="primary" onClick={onUpdate} title="UPDATE a random row: new version, old one marked dead">
        Update
      </VizButton>

      <VizButton
        variant={snap.deadRemovable > 0 ? "primary" : "default"}
        onClick={onVacuum}
        title="Run VACUUM: remove dead tuples below the xmin horizon"
      >
        Vacuum
      </VizButton>

      <VizButton
        variant={txnOpen ? "danger" : "default"}
        onClick={onToggleLongTxn}
        title={
          txnOpen
            ? `COMMIT the long transaction (snapshot xmin ${snap.longTxn!.snapshotXmin}) and release the horizon`
            : "Open a REPEATABLE READ transaction and hold its snapshot"
        }
      >
        {txnOpen ? `Commit txn (xmin ${snap.longTxn!.snapshotXmin})` : "Hold a long txn"}
      </VizButton>

      <div style={SEP} />

      <VizToggle
        pressed={snap.autoUpdate}
        label={`workload ${snap.autoUpdate ? "on" : "off"}`}
        onClick={onToggleAutoUpdate}
        title="Toggle a streaming UPDATE workload (~4/s)"
      />

      <VizToggle
        pressed={snap.autoVacuum}
        label={`autovacuum ${snap.autoVacuum ? "on" : "off"}`}
        onClick={onToggleAutoVacuum}
        title={`Toggle autovacuum (runs when dead tuples ≥ ${snap.autovacuumThreshold})`}
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
