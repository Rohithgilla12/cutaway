import type { PageView } from "../sim/walSim";

interface Props {
  pages: PageView[];
  phase: string;
  currentReplayLsn: number | null;
}

const CELL_W = 76;
const CELL_H = 36;
const GAP = 4;
const COLS = 8;

export function PageGrid({ pages, phase, currentReplayLsn }: Props) {
  const crashed = phase === "crashed" || phase === "recovering" || phase === "recovered";
  const totalW = COLS * (CELL_W + GAP) - GAP;

  return (
    <div style={{ fontFamily: "var(--font-mono)" }}>
      <div
        style={{
          fontSize: 10,
          color: "var(--color-muted)",
          marginBottom: 4,
          letterSpacing: "0.05em",
        }}
      >
        DATA PAGES
      </div>

      <svg viewBox={`0 0 ${totalW} ${CELL_H}`} width="100%" aria-hidden="true" style={{ display: "block" }}>
        {pages.map((p, i) => {
          const x = i * (CELL_W + GAP);
          const memWiped = phase === "crashed" || phase === "recovering";
          const memDirty = !crashed && p.memory !== p.disk;
          const isReplaying = currentReplayLsn !== null && phase === "recovering" && p.memory !== p.disk;

          const memColor = memWiped ? "var(--color-muted)" : memDirty ? "var(--color-pending)" : "var(--color-ok)";

          return (
            <g key={p.pageId}>
              <rect
                x={x}
                y={0}
                width={CELL_W}
                height={CELL_H}
                fill="var(--color-raised)"
                stroke={isReplaying ? "var(--color-entity)" : "var(--color-rule)"}
                strokeWidth={isReplaying ? 1.5 : 1}
                rx={3}
              />
              <rect
                x={x + 2}
                y={2}
                width={CELL_W / 2 - 3}
                height={CELL_H - 4}
                fill={memColor}
                fillOpacity={0.18}
                rx={2}
              />
              <rect
                x={x + CELL_W / 2 + 1}
                y={2}
                width={CELL_W / 2 - 3}
                height={CELL_H - 4}
                fill="var(--color-muted)"
                fillOpacity={0.1}
                rx={2}
              />
              <line
                x1={x + CELL_W / 2}
                y1={4}
                x2={x + CELL_W / 2}
                y2={CELL_H - 4}
                stroke="var(--color-rule)"
                strokeWidth={1}
              />
            </g>
          );
        })}
      </svg>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gap: `0 ${GAP}px`,
          marginTop: 2,
          fontSize: 9,
          color: "var(--color-muted)",
          textAlign: "center",
        }}
      >
        {pages.map((p) => (
          <div key={p.pageId} style={{ overflow: "hidden" }}>
            pg{p.pageId}
          </div>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gap: `0 ${GAP}px`,
          marginTop: 2,
          fontSize: 10,
          fontWeight: 600,
          textAlign: "center",
        }}
      >
        {pages.map((p) => {
          const memWiped = phase === "crashed" || phase === "recovering";
          const crashed = phase === "crashed" || phase === "recovering" || phase === "recovered";
          const memDirty = !crashed && p.memory !== p.disk;
          const memColor = memWiped ? "var(--color-muted)" : memDirty ? "var(--color-pending)" : "var(--color-ok)";
          return (
            <div key={p.pageId} style={{ color: memColor }} title={`mem=${memWiped ? "?" : p.memory} disk=${p.disk}`}>
              <span>{memWiped ? "?" : p.memory}</span>
              <span style={{ color: "var(--color-rule)", fontWeight: 400 }}>/</span>
              <span style={{ color: "var(--color-muted)", fontWeight: 400 }}>{p.disk}</span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          fontSize: 9,
          color: "var(--color-muted)",
          marginTop: 3,
          fontStyle: "italic",
        }}
      >
        mem/disk per page
      </div>
    </div>
  );
}
