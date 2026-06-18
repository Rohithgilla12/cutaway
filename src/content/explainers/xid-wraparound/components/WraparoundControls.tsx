import type { WraparoundSnapshot } from "../sim/wraparoundSim";
import { VizButton, VizToggle, SpeedControl, PlayPauseOrStep } from "../../../../lib/viz";

const SEP: React.CSSProperties = {
  width: 1,
  height: 28,
  background: "var(--color-rule)",
  margin: "0 2px",
  flexShrink: 0,
};

interface Props {
  snap: WraparoundSnapshot;
  paused: boolean;
  speed: number;
  reducedMotion: boolean;
  onBurn: () => void;
  onFreeze: () => void;
  onTogglePin: () => void;
  onToggleWorkload: () => void;
  onToggleAutoVacuum: () => void;
  onTogglePause: () => void;
  onStep: () => void;
  onReset: () => void;
  onSpeedChange: (s: number) => void;
}

export function WraparoundControls({
  snap,
  paused,
  speed,
  reducedMotion,
  onBurn,
  onFreeze,
  onTogglePin,
  onToggleWorkload,
  onToggleAutoVacuum,
  onTogglePause,
  onStep,
  onReset,
  onSpeedChange,
}: Props) {
  const pinned = snap.pinnedXmin !== null;
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
      <VizButton variant="primary" onClick={onBurn} title="Consume 100M transaction IDs in one burst">
        Burn 100M xids
      </VizButton>

      <VizButton
        variant={snap.age > 60 ? "primary" : "default"}
        onClick={onFreeze}
        title="Run VACUUM FREEZE: advance relfrozenxid toward nextXid (bounded by the oldest snapshot)"
      >
        VACUUM FREEZE
      </VizButton>

      <VizButton
        variant={pinned ? "danger" : "default"}
        onClick={onTogglePin}
        title={
          pinned
            ? `COMMIT the held transaction (pinned at xid ${snap.pinnedXmin}) and release the freeze horizon`
            : "Hold a long transaction: pin the freeze horizon at the current xid"
        }
      >
        {pinned ? `Release snapshot (${snap.pinnedXmin})` : "Hold a long txn"}
      </VizButton>

      <div style={SEP} />

      <VizToggle
        pressed={snap.workload}
        label={`workload ${snap.workload ? "on" : "off"}`}
        onClick={onToggleWorkload}
        title="Stream transactions that consume xids (~200M/s)"
      />
      <VizToggle
        pressed={snap.autoVacuum}
        label={`autovacuum ${snap.autoVacuum ? "on" : "off"}`}
        onClick={onToggleAutoVacuum}
        title="Toggle routine autovacuum freezing (anti-wraparound vacuum still runs regardless once age ≥ 200M)"
      />

      <div style={SEP} />

      <PlayPauseOrStep paused={paused} reducedMotion={reducedMotion} onTogglePause={onTogglePause} onStep={onStep} />
      <VizButton onClick={onReset} title="Reset to a healthy cluster">
        Reset
      </VizButton>
      {!reducedMotion && <SpeedControl speed={speed} onSpeedChange={onSpeedChange} />}
    </div>
  );
}
