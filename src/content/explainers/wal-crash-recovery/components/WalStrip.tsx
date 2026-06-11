import type { WalRecordView } from "../sim/walSim";

interface Props {
  records: WalRecordView[];
  lastDurableLsn: number;
  checkpointLsn: number;
  currentReplayLsn: number | null;
  phase: string;
}

const BLOCK_W = 20;
const BLOCK_H = 28;
const BLOCK_GAP = 3;
const STRIP_Y = 60;
const WINDOW = 30;

function recordColor(r: WalRecordView, currentReplayLsn: number | null): string {
  if (r.replayed || r.lsn === currentReplayLsn) return "var(--color-entity)";
  if (r.durability === "torn") return "var(--color-danger)";
  if (r.durability === "durable") return "var(--color-ok)";
  return "var(--color-pending)";
}

function kindGlyph(kind: string): string {
  if (kind === "commit") return "C";
  if (kind === "begin") return "B";
  return "U";
}

export function WalStrip({ records, lastDurableLsn, checkpointLsn, currentReplayLsn }: Props) {
  const sorted = [...records].sort((a, b) => a.lsn - b.lsn);
  const windowed = sorted.slice(-WINDOW);
  const offset = sorted.length > WINDOW ? sorted.length - WINDOW : 0;

  const totalW = Math.max(windowed.length * (BLOCK_W + BLOCK_GAP) + 20, 700);

  return (
    <svg
      viewBox={`0 0 700 130`}
      width="100%"
      aria-label="WAL record strip"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      <text x="4" y="14" fontSize="10" fill="var(--color-muted)">
        WAL STRIP (last {WINDOW} records)
      </text>

      {windowed.map((r, i) => {
        const x = 4 + i * (BLOCK_W + BLOCK_GAP);
        const color = recordColor(r, currentReplayLsn);
        const isTorn = r.durability === "torn";
        const isReplaying = r.replayed || r.lsn === currentReplayLsn;

        return (
          <g key={r.lsn}>
            <rect
              x={x}
              y={STRIP_Y - BLOCK_H / 2}
              width={BLOCK_W}
              height={BLOCK_H}
              fill={isReplaying ? "var(--color-entity)" : "none"}
              fillOpacity={isReplaying ? 0.15 : 0}
              stroke={color}
              strokeWidth={isTorn ? 1.5 : 1}
              strokeDasharray={isTorn ? "3,2" : undefined}
              rx={2}
            />
            <text
              x={x + BLOCK_W / 2}
              y={STRIP_Y - 4}
              textAnchor="middle"
              fontSize="8"
              fill={color}
              fontWeight={isReplaying ? "600" : "400"}
            >
              {kindGlyph(r.kind)}
            </text>
            <text
              x={x + BLOCK_W / 2}
              y={STRIP_Y + 8}
              textAnchor="middle"
              fontSize="7"
              fill="var(--color-muted)"
            >
              {r.lsn + offset}
            </text>
          </g>
        );
      })}

      {(() => {
        const durableIdx = windowed.findLastIndex((r) => r.lsn === lastDurableLsn);
        if (durableIdx < 0) return null;
        const mx = 4 + durableIdx * (BLOCK_W + BLOCK_GAP) + BLOCK_W;
        return (
          <g>
            <line
              x1={mx}
              y1={STRIP_Y - BLOCK_H / 2 - 6}
              x2={mx}
              y2={STRIP_Y + BLOCK_H / 2 + 6}
              stroke="var(--color-ok)"
              strokeWidth={1.5}
              strokeDasharray="4,2"
            />
            <text x={mx + 3} y={STRIP_Y - BLOCK_H / 2 - 8} fontSize="8" fill="var(--color-ok)">
              durable ▸ LSN {lastDurableLsn}
            </text>
          </g>
        );
      })()}

      {(() => {
        const ckIdx = windowed.findLastIndex((r) => r.lsn === checkpointLsn);
        if (ckIdx < 0 || checkpointLsn === 0) return null;
        const cx = 4 + ckIdx * (BLOCK_W + BLOCK_GAP);
        return (
          <g>
            <line
              x1={cx}
              y1={STRIP_Y - BLOCK_H / 2 - 6}
              x2={cx}
              y2={STRIP_Y + BLOCK_H / 2 + 6}
              stroke="var(--color-muted)"
              strokeWidth={1}
              strokeDasharray="2,2"
            />
            <text
              x={cx - 3}
              y={STRIP_Y + BLOCK_H / 2 + 16}
              fontSize="8"
              fill="var(--color-muted)"
              textAnchor="end"
            >
              ckpt LSN {checkpointLsn}
            </text>
          </g>
        );
      })()}

      <g transform="translate(4,100)">
        {[
          { color: "var(--color-ok)", glyph: "✓", label: "durable" },
          { color: "var(--color-pending)", glyph: "◌", label: "unsynced" },
          { color: "var(--color-danger)", glyph: "✕", label: "torn" },
          { color: "var(--color-entity)", glyph: "▸", label: "replaying" },
          { color: "var(--color-dead)", glyph: "—", label: "disk-stale" },
        ].map(({ color, glyph, label }, i) => (
          <g key={label} transform={`translate(${i * 130}, 0)`}>
            <text fontSize="9" fill={color}>
              {glyph}
            </text>
            <text x={14} fontSize="9" fill="var(--color-muted)">
              {label}
            </text>
          </g>
        ))}
      </g>

      <text x={totalW - 4} y={14} fontSize="9" fill="var(--color-muted)" textAnchor="end">
        {windowed.length === 0 && "no records yet"}
      </text>
    </svg>
  );
}
