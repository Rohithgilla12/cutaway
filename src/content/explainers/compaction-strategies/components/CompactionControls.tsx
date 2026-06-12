import type { CompactionSnapshot, Strategy } from "../sim/compactionSim";
import { INGEST_MIN, INGEST_MAX } from "../sim/compactionSim";
import { VizButton, VizToggle, SpeedControl, PlayPauseOrStep } from "../../../../lib/viz";

interface Props {
  snap: CompactionSnapshot;
  paused: boolean;
  speed: number;
  reducedMotion: boolean;
  onStrategy: (s: Strategy) => void;
  onIngestRate: (n: number) => void;
  onRead: () => void;
  onFullCompaction: () => void;
  onToggleAutoRead: () => void;
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

export function CompactionControls({
  snap,
  paused,
  speed,
  reducedMotion,
  onStrategy,
  onIngestRate,
  onRead,
  onFullCompaction,
  onToggleAutoRead,
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
      <VizToggle
        pressed={snap.strategy === "leveled"}
        label="leveled"
        onClick={() => onStrategy("leveled")}
        title="Leveled compaction: one sorted run per level below L0"
      />
      <VizToggle
        pressed={snap.strategy === "tiered"}
        label="tiered"
        onClick={() => onStrategy("tiered")}
        title="Tiered (universal) compaction: merge a tier only when enough similar runs pile up"
      />

      <div style={SEP} />

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, minWidth: 0 }}>
        <span style={{ color: "var(--color-muted)", whiteSpace: "nowrap" }}>ingest</span>
        <input
          type="range"
          min={INGEST_MIN}
          max={INGEST_MAX}
          value={snap.ingestRate}
          onChange={(e) => onIngestRate(Number(e.target.value))}
          style={{ width: 110, height: 28 }}
          aria-label="Ingest rate, entries per second"
        />
        <span style={{ fontWeight: 600, whiteSpace: "nowrap", width: 38 }}>{snap.ingestRate}/s</span>
      </label>

      <div style={SEP} />

      <VizButton onClick={onRead} title="Point-read a random key and trace the probes">
        Read
      </VizButton>

      <VizButton onClick={onFullCompaction} title="Merge every run into one (watch space spike first)">
        Full compact
      </VizButton>

      <VizToggle
        pressed={snap.autoRead}
        label={`auto-read ${snap.autoRead ? "on" : "off"}`}
        onClick={onToggleAutoRead}
        title="Toggle background point reads (2/s) feeding the read-amp meter"
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
