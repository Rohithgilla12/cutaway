import type { RaftSnapshot } from "../sim/raftSim";
import { VizButton, SpeedControl, PlayPauseOrStep } from "../../../../lib/viz";

interface Props {
  snap: RaftSnapshot;
  paused: boolean;
  speed: number;
  reducedMotion: boolean;
  onIsolateLeader: () => void;
  onSplit: () => void;
  onHealAll: () => void;
  onClientWrite: () => void;
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

export function RaftControls({
  snap,
  paused,
  speed,
  reducedMotion,
  onIsolateLeader,
  onSplit,
  onHealAll,
  onClientWrite,
  onTogglePause,
  onStep,
  onReset,
  onSpeedChange,
}: Props) {
  const hasLeader = snap.nodes.some((n) => n.alive && n.role === "leader");
  const hasDownLinks = snap.links.some((l) => !l.up);

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
        variant="primary"
        disabled={!hasLeader}
        onClick={onClientWrite}
        title="Append a value to the current leader's log"
      >
        Client write
      </VizButton>

      <div style={SEP} />

      <VizButton
        disabled={!hasLeader}
        onClick={onIsolateLeader}
        title="Cut all links to the current leader — triggers a new election in the majority partition"
      >
        Isolate leader
      </VizButton>

      <VizButton onClick={onSplit} title="Partition nodes 0–1 from 2–4 (minority vs majority)">
        Split 2/3
      </VizButton>

      <VizButton disabled={!hasDownLinks} onClick={onHealAll} title="Restore all cut links">
        Heal all
      </VizButton>

      <div style={SEP} />

      <PlayPauseOrStep paused={paused} reducedMotion={reducedMotion} onTogglePause={onTogglePause} onStep={onStep} />

      <VizButton onClick={onReset} title="Reset simulation to initial seeded state">
        Reset
      </VizButton>

      <SpeedControl speed={speed} onSpeedChange={onSpeedChange} />
    </div>
  );
}
