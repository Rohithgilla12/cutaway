import type { LsmSnapshot, SSTableView, ReadPath } from "../sim/lsmSim";
import { KEY_COUNT, MEMTABLE_FLUSH_THRESHOLD } from "../sim/lsmSim";

const VB_W = 700;

const MEM_Y = 30;
const MEM_H = 38;
const L0_Y = 110;
const L0_H = 32;
const L0_ROW_STEP = 36;
const L1_Y = 240;
const L1_H = 38;

const X_PAD = 16;
const KEY_AXIS_W = VB_W - X_PAD * 2;

function keyIndex(key: string): number {
  return parseInt(key.slice(1), 10);
}

function keyX(key: string): number {
  return X_PAD + (keyIndex(key) / KEY_COUNT) * KEY_AXIS_W;
}

function rangeX(minKey: string | null): number {
  if (minKey === null) return X_PAD;
  return keyX(minKey);
}

function rangeW(minKey: string | null, maxKey: string | null): number {
  if (minKey === null || maxKey === null) return 10;
  return Math.max(keyX(maxKey) - keyX(minKey) + KEY_AXIS_W / KEY_COUNT, 4);
}

interface TableBarProps {
  table: SSTableView;
  y: number;
  h: number;
  fill: string;
  stroke: string;
  opacity?: number;
}

function TableBar({ table, y, h, fill, stroke, opacity = 1 }: TableBarProps) {
  const x = rangeX(table.minKey);
  const w = rangeW(table.minKey, table.maxKey);
  const hasTombstones = table.tombstoneCount > 0;

  return (
    <g opacity={opacity}>
      <rect x={x} y={y} width={w} height={h} fill={fill} fillOpacity={0.18} stroke={stroke} strokeWidth={1.5} rx={3} />
      {hasTombstones && (
        <>
          <line
            x1={x + w - 10}
            y1={y + 4}
            x2={x + w - 4}
            y2={y + h - 4}
            stroke="var(--color-danger)"
            strokeWidth={1.5}
          />
          <line
            x1={x + w - 4}
            y1={y + 4}
            x2={x + w - 10}
            y2={y + h - 4}
            stroke="var(--color-danger)"
            strokeWidth={1.5}
          />
        </>
      )}
    </g>
  );
}

function probeY(probe: ReadPath["probes"][number], snap: LsmSnapshot): number {
  if (probe.structure === "memtable") {
    return MEM_Y + MEM_H / 2;
  }
  if (probe.structure === "L0") {
    const idx = snap.l0.findIndex((t) => t.id === probe.tableId);
    const row = idx >= 0 ? idx : 0;
    return L0_Y + row * L0_ROW_STEP + L0_H / 2;
  }
  return L1_Y + L1_H / 2;
}

function probeX(probe: ReadPath["probes"][number], key: string, snap: LsmSnapshot): number {
  if (probe.structure === "memtable") {
    return keyX(key);
  }
  if (probe.structure === "L0") {
    const table = snap.l0.find((t) => t.id === probe.tableId);
    if (!table || table.minKey === null || table.maxKey === null) return keyX(key);
    const cx = rangeX(table.minKey) + rangeW(table.minKey, table.maxKey) / 2;
    return cx;
  }
  const table = snap.l1.find((t) => t.id === probe.tableId);
  if (!table || table.minKey === null || table.maxKey === null) return keyX(key);
  return rangeX(table.minKey) + rangeW(table.minKey, table.maxKey) / 2;
}

function dotColor(probe: ReadPath["probes"][number]): string {
  if (!probe.hit) return "var(--color-dead)";
  if (probe.found === "tombstone") return "var(--color-danger)";
  return "var(--color-ok)";
}

interface Props {
  snap: LsmSnapshot;
}

export function LevelDiagram({ snap }: Props) {
  const memFill = snap.memtable.length / MEMTABLE_FLUSH_THRESHOLD;
  const memW = Math.max(4, memFill * KEY_AXIS_W);

  const l0MaxRows = Math.max(snap.l0.length, 1);
  const l1TopY = L0_Y + l0MaxRows * L0_ROW_STEP + 16;
  const usedL1Y = Math.max(l1TopY, L1_Y);
  const totalH = usedL1Y + L1_H + 20;

  const path = snap.lastReadPath;

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${totalH}`}
      width="100%"
      aria-hidden="true"
      style={{ display: "block", overflow: "visible" }}
    >
      {/* memtable band */}
      <rect
        x={X_PAD}
        y={MEM_Y}
        width={KEY_AXIS_W}
        height={MEM_H}
        fill="var(--color-rule)"
        fillOpacity={0.25}
        stroke="var(--color-rule)"
        strokeWidth={1}
        rx={3}
      />
      <rect x={X_PAD} y={MEM_Y} width={memW} height={MEM_H} fill="var(--color-entity)" fillOpacity={0.22} rx={3} />

      {/* L0 band background */}
      <rect
        x={X_PAD - 4}
        y={L0_Y - 8}
        width={KEY_AXIS_W + 8}
        height={l0MaxRows * L0_ROW_STEP + 4}
        fill="none"
        stroke={snap.compactionPressure ? "var(--color-pending)" : "var(--color-rule)"}
        strokeWidth={snap.compactionPressure ? 2 : 1}
        strokeDasharray={snap.compactionPressure ? "none" : undefined}
        rx={4}
        fillOpacity={0}
      />

      {/* L0 SSTables — newest first (index 0 = newest = top) */}
      {snap.l0.map((table, i) => (
        <TableBar
          key={table.id}
          table={table}
          y={L0_Y + i * L0_ROW_STEP}
          h={L0_H}
          fill="var(--color-entity)"
          stroke="var(--color-entity)"
        />
      ))}

      {/* L1 band background */}
      <rect
        x={X_PAD - 4}
        y={usedL1Y - 8}
        width={KEY_AXIS_W + 8}
        height={L1_H + 16}
        fill="none"
        stroke="var(--color-rule)"
        strokeWidth={1}
        rx={4}
      />

      {/* L1 SSTables */}
      {snap.l1.map((table) => (
        <TableBar key={table.id} table={table} y={usedL1Y} h={L1_H} fill="var(--color-ok)" stroke="var(--color-ok)" />
      ))}

      {/* Read path overlay */}
      {path &&
        path.probes.map((probe, i) => {
          const cx = probeX(probe, path.key, snap);
          const cy = probeY(probe, snap);
          const color = dotColor(probe);
          const prevProbe = i > 0 ? path.probes[i - 1] : null;
          const prevCx = prevProbe ? probeX(prevProbe, path.key, snap) : cx;
          const prevCy = prevProbe ? probeY(prevProbe, snap) : cy;

          return (
            <g key={i}>
              {prevProbe && (
                <line
                  x1={prevCx}
                  y1={prevCy}
                  x2={cx}
                  y2={cy}
                  stroke={color}
                  strokeWidth={1.5}
                  strokeDasharray="4,2"
                  opacity={0.7}
                />
              )}
              <circle cx={cx} cy={cy} r={6} fill={color} fillOpacity={0.9} />
              {!probe.hit && (
                <>
                  <line x1={cx - 3} y1={cy - 3} x2={cx + 3} y2={cy + 3} stroke="var(--color-paper)" strokeWidth={1.5} />
                  <line x1={cx + 3} y1={cy - 3} x2={cx - 3} y2={cy + 3} stroke="var(--color-paper)" strokeWidth={1.5} />
                </>
              )}
              {probe.hit && probe.found === "value" && (
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize="8" fill="var(--color-paper)" fontWeight="700">
                  ✓
                </text>
              )}
              {probe.hit && probe.found === "tombstone" && (
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize="8" fill="var(--color-paper)" fontWeight="700">
                  ✕
                </text>
              )}
            </g>
          );
        })}

      {/* key axis tick at read key position */}
      {path && (
        <line
          x1={keyX(path.key)}
          y1={MEM_Y - 4}
          x2={keyX(path.key)}
          y2={usedL1Y + L1_H + 4}
          stroke="var(--color-muted)"
          strokeWidth={1}
          strokeDasharray="2,3"
          opacity={0.5}
        />
      )}
    </svg>
  );
}
