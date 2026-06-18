import type { WraparoundSnapshot, ClusterStatus } from "../sim/wraparoundSim";
import { WRAP_SPACE, FREEZE_MAX_AGE, AGE_WARN, AGE_REFUSE } from "../sim/wraparoundSim";

const STATUS_COLOR: Record<ClusterStatus, string> = {
  healthy: "var(--color-ok)",
  forcing: "var(--color-pending)",
  warning: "var(--color-pending)",
  refusing: "var(--color-danger)",
};

const CX = 110;
const CY = 110;
const R = 86;

// Angle 0 at 12 o'clock, sweeping clockwise. A fraction of the xid space maps
// to a fraction of the full turn.
function polar(fracOfTurn: number, radius = R): [number, number] {
  const a = fracOfTurn * 2 * Math.PI - Math.PI / 2;
  return [CX + radius * Math.cos(a), CY + radius * Math.sin(a)];
}

function arcPath(fromFrac: number, toFrac: number, radius = R): string {
  const [x1, y1] = polar(fromFrac, radius);
  const [x2, y2] = polar(toFrac, radius);
  const large = toFrac - fromFrac > 0.5 ? 1 : 0;
  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
}

function Tick({ frac, color, label }: { frac: number; color: string; label: string }) {
  const [xi, yi] = polar(frac, R - 7);
  const [xo, yo] = polar(frac, R + 7);
  const [lx, ly] = polar(frac, R + 20);
  return (
    <>
      <line x1={xi} y1={yi} x2={xo} y2={yo} stroke={color} strokeWidth={1.5} />
      <text x={lx} y={ly} fontSize={7} fill={color} textAnchor="middle" dominantBaseline="middle">
        {label}
      </text>
    </>
  );
}

export function XidRing({ snap }: { snap: WraparoundSnapshot }) {
  const ageFrac = Math.min(snap.age / WRAP_SPACE, 1);
  const color = STATUS_COLOR[snap.status];
  // relfrozenxid anchored at the top; the unfrozen arc sweeps clockwise to nextXid.
  const pinnedAgeFrac = snap.pinnedXmin !== null ? (snap.pinnedXmin - snap.relfrozenXid) / WRAP_SPACE : null;

  return (
    <svg viewBox="0 0 220 220" width="100%" style={{ maxWidth: 260, display: "block", margin: "0 auto" }} role="img" aria-label={`transaction id space, age ${snap.age} million, status ${snap.status}`}>
      {/* the full xid space */}
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="var(--color-rule)" strokeWidth={10} />
      {/* the unfrozen (consumed) arc = age */}
      {ageFrac > 0.001 && (
        <path d={arcPath(0, ageFrac)} fill="none" stroke={color} strokeWidth={10} strokeLinecap="butt" />
      )}

      {/* threshold ticks */}
      <Tick frac={FREEZE_MAX_AGE / WRAP_SPACE} color="var(--color-pending)" label="force" />
      <Tick frac={AGE_WARN / WRAP_SPACE} color="var(--color-danger)" label="warn" />
      <Tick frac={AGE_REFUSE / WRAP_SPACE} color="var(--color-danger)" label="stop" />

      {/* relfrozenxid marker (anchor, top) */}
      <circle cx={polar(0)[0]} cy={polar(0)[1]} r={5} fill="var(--color-ok)" stroke="var(--color-raised)" strokeWidth={1.5} />

      {/* pinned horizon, inside the arc */}
      {pinnedAgeFrac !== null && (
        <circle
          cx={polar(pinnedAgeFrac)[0]}
          cy={polar(pinnedAgeFrac)[1]}
          r={4}
          fill="var(--color-pending)"
          stroke="var(--color-raised)"
          strokeWidth={1.5}
        />
      )}

      {/* nextXid pointer (leading edge) */}
      <circle cx={polar(ageFrac)[0]} cy={polar(ageFrac)[1]} r={5} fill="var(--color-ink)" stroke="var(--color-raised)" strokeWidth={1.5} />

      {/* center readout */}
      <text x={CX} y={CY - 6} textAnchor="middle" fontSize={20} fontWeight={700} fill={color}>
        {snap.age}M
      </text>
      <text x={CX} y={CY + 9} textAnchor="middle" fontSize={8} fill="var(--color-muted)">
        age of oldest xid
      </text>
      <text x={CX} y={CY + 22} textAnchor="middle" fontSize={8} fill="var(--color-muted)">
        {snap.remaining}M to wraparound
      </text>
    </svg>
  );
}
