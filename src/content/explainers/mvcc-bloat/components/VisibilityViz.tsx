import { useState } from "react";
import { visibleToSnapshot, classifyTuple } from "../sim/visibility";

const XID_MAX = 60;
const AXIS_LEFT = 45;
const AXIS_RIGHT = 655;

function xOf(xid: number): number {
  return AXIS_LEFT + (xid / XID_MAX) * (AXIS_RIGHT - AXIS_LEFT);
}

interface SliderProps {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  onChange: (v: number) => void;
}

function XidSlider({ label, value, display, min, max, onChange }: SliderProps) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        minWidth: 0,
      }}
    >
      <span style={{ width: 130, flexShrink: 0, color: "var(--color-muted)" }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, minWidth: 80, height: 28 }}
      />
      <span style={{ width: 72, flexShrink: 0, fontWeight: 600 }}>{display}</span>
    </label>
  );
}

function Verdict({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={{ color: "var(--color-muted)" }}>{label} </span>
      <span style={{ color, fontWeight: 700 }}>{value}</span>
    </span>
  );
}

export default function VisibilityViz() {
  const [xmin, setXmin] = useState(15);
  const [xmaxRaw, setXmaxRaw] = useState(35);
  const [snapXmin, setSnapXmin] = useState(25);

  // Slider positions at or below xmin mean "never deleted" (xmax = 0).
  const xmax = xmaxRaw > xmin ? xmaxRaw : 0;
  const live = xmax === 0;

  const visible = visibleToSnapshot(xmin, xmax, snapXmin);
  const fate = classifyTuple(xmax, snapXmin);

  const fateColor =
    fate === "live" ? "var(--color-ok)" : fate === "dead-removable" ? "var(--color-dead)" : "var(--color-pending)";
  const barColor = fateColor;
  const endX = live ? AXIS_RIGHT : xOf(xmax);

  const caption = `tuple xmin ${xmin}, xmax ${live ? "none" : xmax}; snapshot xmin ${snapXmin}: ${
    visible ? "visible to snapshot" : "not visible to snapshot"
  }, ${fate}`;

  return (
    <div style={{ fontFamily: "var(--font-mono)" }}>
      <div aria-live="polite" className="sr-only">
        {caption}
      </div>

      <svg viewBox="0 0 700 190" style={{ width: "100%", display: "block" }} role="img" aria-label={caption}>
        {/* xid axis */}
        <line x1={AXIS_LEFT} y1={140} x2={AXIS_RIGHT} y2={140} stroke="var(--color-rule)" strokeWidth={1.5} />
        {[0, 10, 20, 30, 40, 50, 60].map((t) => (
          <g key={t}>
            <line x1={xOf(t)} y1={134} x2={xOf(t)} y2={146} stroke="var(--color-rule)" strokeWidth={1.5} />
            <text x={xOf(t)} y={172} textAnchor="middle" fontSize={20} fill="var(--color-muted)">
              {t}
            </text>
          </g>
        ))}
        <text x={AXIS_RIGHT + 6} y={147} fontSize={20} fill="var(--color-muted)">
          xid →
        </text>

        {/* tuple lifespan bar */}
        <line x1={xOf(xmin)} y1={88} x2={endX} y2={88} stroke={barColor} strokeWidth={8} strokeLinecap="butt" />
        {live && (
          <text x={endX + 2} y={96} fontSize={24} fill={barColor}>
            →
          </text>
        )}
        <circle cx={xOf(xmin)} cy={88} r={7} fill={barColor} />
        <text x={xOf(xmin)} y={68} textAnchor="middle" fontSize={22} fill="var(--color-ink)">
          xmin {xmin}
        </text>
        {!live && (
          <>
            <circle cx={xOf(xmax)} cy={88} r={7} fill={barColor} />
            {/* below the bar so it never collides with the xmin label when the
                lifespan is short */}
            <text x={xOf(xmax)} y={118} textAnchor="middle" fontSize={22} fill="var(--color-ink)">
              xmax {xmax}
            </text>
          </>
        )}

        {/* snapshot xmin marker (== vacuum horizon with one open snapshot) */}
        <line
          x1={xOf(snapXmin)}
          y1={34}
          x2={xOf(snapXmin)}
          y2={140}
          stroke="var(--color-entity)"
          strokeWidth={2}
          strokeDasharray="5 3"
        />
        {/* clamp so the wide label stays inside the viewBox at the extremes */}
        <text
          x={Math.min(Math.max(xOf(snapXmin), 105), 595)}
          y={26}
          textAnchor="middle"
          fontSize={22}
          fill="var(--color-entity)"
        >
          snapshot xmin {snapXmin}
        </text>
      </svg>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 24px",
          fontSize: 11,
          padding: "8px 4px",
          borderTop: "1px solid var(--color-rule)",
        }}
      >
        <Verdict
          label="visible to snapshot?"
          value={visible ? "YES" : "NO"}
          color={visible ? "var(--color-ok)" : "var(--color-danger)"}
        />
        <Verdict label="state" value={live ? "live" : "dead"} color={fateColor} />
        <Verdict
          label="vacuum may remove?"
          value={fate === "live" ? "— (not dead)" : fate === "dead-removable" ? "YES" : "NO (pinned)"}
          color={
            fate === "dead-removable"
              ? "var(--color-ok)"
              : fate === "dead-pinned"
                ? "var(--color-pending)"
                : "var(--color-muted)"
          }
        />
      </div>

      <div style={{ display: "grid", gap: 6, padding: "8px 4px 4px" }}>
        <XidSlider label="tuple xmin" value={xmin} display={String(xmin)} min={1} max={50} onChange={setXmin} />
        <XidSlider
          label="tuple xmax"
          value={xmaxRaw}
          display={live ? "– (live)" : String(xmax)}
          min={1}
          max={XID_MAX}
          onChange={setXmaxRaw}
        />
        <XidSlider
          label="snapshot xmin"
          value={snapXmin}
          display={String(snapXmin)}
          min={1}
          max={XID_MAX}
          onChange={setSnapXmin}
        />
      </div>

      <p style={{ fontSize: 10, color: "var(--color-muted)", margin: "4px 4px 0", fontStyle: "italic" }}>
        With a single open snapshot, the vacuum horizon equals its xmin — slide it left of xmax and watch a removable
        tuple become pinned. Drag xmax at or below xmin for a never-deleted (live) tuple.
      </p>
    </div>
  );
}
