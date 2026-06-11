import type { WalRecordView } from "../sim/walSim";
import { Legend } from "../../../../lib/viz";

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
const STRIP_Y = 30;
const WINDOW = 30;

function recordColor(r: WalRecordView, currentReplayLsn: number | null, phase: string): string {
  if (phase === "recovered" && r.durability === "buffered") return "var(--color-dead)";
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

export function WalStrip({ records, lastDurableLsn, checkpointLsn, currentReplayLsn, phase }: Props) {
  const sorted = [...records].sort((a, b) => a.lsn - b.lsn);
  const windowed = sorted.slice(-WINDOW);
  const offset = sorted.length > WINDOW ? sorted.length - WINDOW : 0;

  const svgH = STRIP_Y + BLOCK_H / 2 + 10;
  const totalW = 700;

  const firstLsn = windowed.length > 0 ? windowed[0].lsn + offset : 0;
  const lastLsn = windowed.length > 0 ? windowed[windowed.length - 1].lsn + offset : 0;

  const durableIdx = windowed.findLastIndex((r) => r.lsn === lastDurableLsn);
  const durableX = durableIdx >= 0 ? 4 + durableIdx * (BLOCK_W + BLOCK_GAP) + BLOCK_W : null;
  const durableInRightHalf = durableX !== null && durableX > totalW / 2;

  const ckIdx = windowed.findLastIndex((r) => r.lsn === checkpointLsn);
  const ckX = ckIdx >= 0 && checkpointLsn !== 0 ? 4 + ckIdx * (BLOCK_W + BLOCK_GAP) : null;

  const legendItems =
    phase === "recovered"
      ? [
          { color: "var(--color-ok)", glyph: "✓", label: "durable" },
          { color: "var(--color-entity)", glyph: "▸", label: "replayed" },
          { color: "var(--color-danger)", glyph: "✕", label: "torn" },
          { color: "var(--color-dead)", glyph: "✕", label: "lost in crash" },
        ]
      : [
          { color: "var(--color-ok)", glyph: "✓", label: "durable" },
          { color: "var(--color-pending)", glyph: "◌", label: "unsynced" },
          { color: "var(--color-danger)", glyph: "✕", label: "torn" },
          { color: "var(--color-entity)", glyph: "▸", label: "replaying" },
          { color: "var(--color-dead)", glyph: "—", label: "disk-stale" },
        ];

  return (
    <div style={{ fontFamily: "var(--font-mono)" }}>
      <div
        style={{
          fontSize: 10,
          color: "var(--color-muted)",
          marginBottom: 2,
          letterSpacing: "0.05em",
        }}
      >
        WAL STRIP (last {WINDOW} records)
      </div>

      <svg
        viewBox={`0 0 ${totalW} ${svgH}`}
        width="100%"
        aria-hidden="true"
        style={{ display: "block", overflow: "visible" }}
      >
        {windowed.map((r, i) => {
          const x = 4 + i * (BLOCK_W + BLOCK_GAP);
          const color = recordColor(r, currentReplayLsn, phase);
          const isTorn = r.durability === "torn";
          const isReplaying = r.replayed || r.lsn === currentReplayLsn;
          const isLost = phase === "recovered" && r.durability === "buffered";

          return (
            <g key={r.lsn}>
              <rect
                x={x}
                y={STRIP_Y - BLOCK_H / 2}
                width={BLOCK_W}
                height={BLOCK_H}
                fill={isReplaying ? "var(--color-entity)" : "none"}
                fillOpacity={isReplaying ? 0.15 : isLost ? 0.08 : 0}
                stroke={color}
                strokeOpacity={isLost ? 0.45 : 1}
                strokeWidth={isTorn ? 1.5 : 1}
                strokeDasharray={isTorn ? "3,2" : undefined}
                rx={2}
              />
              {isLost && (
                <text
                  x={x + BLOCK_W / 2}
                  y={STRIP_Y + 5}
                  textAnchor="middle"
                  fontSize="14"
                  fill="var(--color-dead)"
                  fillOpacity={0.55}
                  fontWeight="700"
                >
                  ✕
                </text>
              )}
              {!isLost && (
                <text
                  x={x + BLOCK_W / 2}
                  y={STRIP_Y + 4}
                  textAnchor="middle"
                  fontSize="12"
                  fill={color}
                  fontWeight={isReplaying ? "600" : "400"}
                >
                  {kindGlyph(r.kind)}
                </text>
              )}
            </g>
          );
        })}

        {durableX !== null && (
          <line
            x1={durableX}
            y1={STRIP_Y - BLOCK_H / 2 - 6}
            x2={durableX}
            y2={STRIP_Y + BLOCK_H / 2 + 6}
            stroke="var(--color-ok)"
            strokeWidth={1.5}
            strokeDasharray="4,2"
          />
        )}

        {ckX !== null && (
          <line
            x1={ckX}
            y1={STRIP_Y - BLOCK_H / 2 - 6}
            x2={ckX}
            y2={STRIP_Y + BLOCK_H / 2 + 6}
            stroke="var(--color-muted)"
            strokeWidth={1}
            strokeDasharray="2,2"
          />
        )}
      </svg>

      <div
        style={{
          fontSize: 10,
          color: "var(--color-muted)",
          marginTop: 2,
          display: "flex",
          gap: "0 16px",
          flexWrap: "wrap",
          rowGap: 2,
        }}
      >
        <span>
          window: LSN {firstLsn}–{lastLsn}
        </span>
        {durableX !== null && (
          <span style={{ color: "var(--color-ok)" }}>
            durable ▸ {lastDurableLsn}
            {durableInRightHalf ? " (right edge)" : ""}
          </span>
        )}
        {ckX !== null && <span>checkpoint ▸ {checkpointLsn}</span>}
      </div>

      <div style={{ marginTop: 6 }}>
        <Legend items={legendItems} />
      </div>
    </div>
  );
}
