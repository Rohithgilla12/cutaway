import type { PageView } from "../sim/walSim";

interface Props {
  pages: PageView[];
  phase: string;
  currentReplayLsn: number | null;
}

const CELL_W = 76;
const CELL_H = 56;
const GAP = 4;
const COLS = 8;

export function PageGrid({ pages, phase, currentReplayLsn }: Props) {
  const crashed = phase === "crashed" || phase === "recovering" || phase === "recovered";
  const totalW = COLS * (CELL_W + GAP) - GAP;

  return (
    <svg
      viewBox={`0 0 ${totalW} ${CELL_H + 40}`}
      width="100%"
      aria-label="Data pages — memory vs disk"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      <text x="0" y="12" fontSize="10" fill="var(--color-muted)">
        DATA PAGES
      </text>

      {pages.map((p, i) => {
        const x = i * (CELL_W + GAP);
        const y = 18;
        const memWiped = phase === "crashed" || phase === "recovering";
        const memDirty = !crashed && p.memory !== p.disk;
        const isReplaying =
          currentReplayLsn !== null && phase === "recovering" && p.memory !== p.disk;

        const memColor = memWiped
          ? "var(--color-muted)"
          : memDirty
            ? "var(--color-pending)"
            : "var(--color-ok)";
        const diskColor = "var(--color-muted)";

        return (
          <g key={p.pageId}>
            <rect
              x={x}
              y={y}
              width={CELL_W}
              height={CELL_H}
              fill="var(--color-raised)"
              stroke={isReplaying ? "var(--color-entity)" : "var(--color-rule)"}
              strokeWidth={isReplaying ? 1.5 : 1}
              rx={3}
            />
            <text
              x={x + CELL_W / 2}
              y={y + 12}
              textAnchor="middle"
              fontSize="8"
              fill="var(--color-muted)"
            >
              pg {p.pageId}
            </text>
            <text
              x={x + CELL_W / 4}
              y={y + 26}
              textAnchor="middle"
              fontSize="7"
              fill="var(--color-muted)"
            >
              mem
            </text>
            <text
              x={x + (CELL_W * 3) / 4}
              y={y + 26}
              textAnchor="middle"
              fontSize="7"
              fill="var(--color-muted)"
            >
              disk
            </text>
            <text
              x={x + CELL_W / 4}
              y={y + 44}
              textAnchor="middle"
              fontSize="13"
              fontWeight="600"
              fill={memColor}
            >
              {memWiped ? "?" : p.memory}
            </text>
            <text
              x={x + (CELL_W * 3) / 4}
              y={y + 44}
              textAnchor="middle"
              fontSize="13"
              fontWeight="600"
              fill={diskColor}
            >
              {p.disk}
            </text>
            <line
              x1={x + CELL_W / 2}
              y1={y + 18}
              x2={x + CELL_W / 2}
              y2={y + CELL_H - 4}
              stroke="var(--color-rule)"
              strokeWidth={1}
            />
          </g>
        );
      })}
    </svg>
  );
}
