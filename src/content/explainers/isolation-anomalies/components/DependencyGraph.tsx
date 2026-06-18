import type { RwEdge } from "../sim/isolationSim";

// A tiny two-node view of the rw-antidependency graph SSI tracks. A single edge
// is harmless; two opposing edges form the cycle that triggers the abort.
export function DependencyGraph({ edges }: { edges: RwEdge[] }) {
  const t1t2 = edges.find((e) => e.from === "T1" && e.to === "T2");
  const t2t1 = edges.find((e) => e.from === "T2" && e.to === "T1");
  const cycle = Boolean(t1t2 && t2t1);
  const danger = "var(--color-danger)";
  const edgeColor = cycle ? danger : "var(--color-entity)";

  return (
    <div
      style={{
        border: "1px solid var(--color-rule)",
        borderRadius: 3,
        padding: "6px 8px",
        fontSize: 10,
        color: "var(--color-muted)",
      }}
    >
      <div style={{ letterSpacing: "0.05em", marginBottom: 2 }}>
        SSI DEPENDENCY GRAPH {cycle && <span style={{ color: danger, fontWeight: 700 }}>— dangerous cycle</span>}
      </div>
      <svg viewBox="0 0 240 64" width="100%" style={{ maxWidth: 280, display: "block" }} role="img" aria-label="rw-antidependency graph between T1 and T2">
        <defs>
          <marker id="iso-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill={edgeColor} />
          </marker>
        </defs>
        {/* T1 → T2 (top arc) */}
        {t1t2 && (
          <>
            <path d="M70,22 C110,6 130,6 170,22" fill="none" stroke={edgeColor} strokeWidth={1.5} markerEnd="url(#iso-arrow)" />
            <text x={120} y={8} textAnchor="middle" fontSize={8} fill={edgeColor}>
              rw: {t1t2.via}
            </text>
          </>
        )}
        {/* T2 → T1 (bottom arc) */}
        {t2t1 && (
          <>
            <path d="M170,42 C130,58 110,58 70,42" fill="none" stroke={edgeColor} strokeWidth={1.5} markerEnd="url(#iso-arrow)" />
            <text x={120} y={62} textAnchor="middle" fontSize={8} fill={edgeColor}>
              rw: {t2t1.via}
            </text>
          </>
        )}
        <circle cx={50} cy={32} r={16} fill="var(--color-raised)" stroke="var(--color-entity)" strokeWidth={1.5} />
        <text x={50} y={36} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--color-entity)">
          T1
        </text>
        <circle cx={190} cy={32} r={16} fill="var(--color-raised)" stroke="var(--color-entity)" strokeWidth={1.5} />
        <text x={190} y={36} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--color-entity)">
          T2
        </text>
      </svg>
      {!t1t2 && !t2t1 && <div>no rw-antidependencies yet</div>}
    </div>
  );
}
