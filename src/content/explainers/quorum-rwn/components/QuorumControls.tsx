import type { QuorumSnapshot } from "../sim/quorumSim";
import { MAX_N } from "../sim/quorumSim";
import { VizButton, VizToggle } from "../../../../lib/viz";

const SEP: React.CSSProperties = {
  width: 1,
  height: 28,
  background: "var(--color-rule)",
  margin: "0 2px",
  flexShrink: 0,
};

function Slider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ fontSize: 10, color: "var(--color-muted)", display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 14, color: "var(--color-ink)", fontWeight: 600 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: 84 }}
        aria-label={label}
      />
      <span style={{ width: 12, color: "var(--color-ink)", fontWeight: 600 }}>{value}</span>
    </label>
  );
}

interface Props {
  snap: QuorumSnapshot;
  onWrite: () => void;
  onRead: () => void;
  onSetN: (v: number) => void;
  onSetR: (v: number) => void;
  onSetW: (v: number) => void;
  onToggleSloppy: () => void;
  onToggleReadRepair: () => void;
  onReset: () => void;
}

export function QuorumControls({
  snap,
  onWrite,
  onRead,
  onSetN,
  onSetR,
  onSetW,
  onToggleSloppy,
  onToggleReadRepair,
  onReset,
}: Props) {
  return (
    <div style={{ fontFamily: "var(--font-mono)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px", alignItems: "center" }}>
        <Slider label="N" value={snap.n} min={3} max={MAX_N} onChange={onSetN} />
        <Slider label="W" value={snap.w} min={1} max={snap.n} onChange={onSetW} />
        <Slider label="R" value={snap.r} min={1} max={snap.n} onChange={onSetR} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: snap.guaranteedOverlap ? "var(--color-ok)" : "var(--color-danger)",
          }}
        >
          R+W = {snap.r + snap.w} {snap.guaranteedOverlap ? ">" : "≤"} N = {snap.n}
        </span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 }}>
        <VizButton variant="primary" onClick={onWrite} title="Write the next version to a W-quorum">
          Write next value
        </VizButton>
        <VizButton variant="primary" onClick={onRead} title="Read from an R-quorum (newest version wins)">
          Read
        </VizButton>

        <div style={SEP} />

        <VizToggle
          pressed={snap.sloppy}
          label={`sloppy quorum ${snap.sloppy ? "on" : "off"}`}
          onClick={onToggleSloppy}
          title="Allow writes to use stand-in nodes (hinted handoff) when preferred replicas are down"
        />
        <VizToggle
          pressed={snap.readRepair}
          label={`read repair ${snap.readRepair ? "on" : "off"}`}
          onClick={onToggleReadRepair}
          title="On read, update stale responders to the freshest version seen"
        />

        <div style={SEP} />

        <VizButton onClick={onReset} title="Reset the cluster">
          Reset
        </VizButton>
      </div>
    </div>
  );
}
