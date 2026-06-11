import type { LsmSnapshot, SSTableView, ReadPath } from "../sim/lsmSim";
import { KEY_COUNT, MEMTABLE_FLUSH_THRESHOLD } from "../sim/lsmSim";

const VB_W = 700;

const MEM_Y = 30;
const MEM_H = 38;
const L0_Y = 110;
const L0_H = 32;
const L0_ROW_STEP = 36;
const L1_H = 38;

// Reserve room for this many L0 rows before the L1 band starts shifting down,
// so the compaction-pressure moment (4 files) causes no layout shift.
const L0_RESERVED_ROWS = 6;
// Hard cap on drawn L0 rows; older files beyond this are summarized in HTML
// (see the per-level chips in LsmViz). Keeps the SVG height bounded under the
// auto-write + auto-flush + no-compact scenario.
export const MAX_L0_ROWS = 12;

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

function visibleL0Rows(snap: LsmSnapshot): number {
  return Math.min(snap.l0.length, MAX_L0_ROWS);
}

function l1BandY(snap: LsmSnapshot): number {
  const rows = Math.max(visibleL0Rows(snap), L0_RESERVED_ROWS);
  return L0_Y + rows * L0_ROW_STEP + 16;
}

interface TableBarProps {
  table: SSTableView;
  y: number;
  h: number;
  fill: string;
  stroke: string;
}

function TableBar({ table, y, h, fill, stroke }: TableBarProps) {
  const x = rangeX(table.minKey);
  const w = rangeW(table.minKey, table.maxKey);
  const hasTombstones = table.tombstoneCount > 0;

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={fill} fillOpacity={0.18} stroke={stroke} strokeWidth={1.5} rx={3} />
      {hasTombstones && (
        // Small filled danger square at the bar's top-right corner: "this table
        // contains tombstones". Distinct from the probe-dot shapes so it cannot
        // be confused with a tombstone HIT on the read path.
        <rect x={x + w - 9} y={y + 3} width={6} height={6} fill="var(--color-danger)" fillOpacity={0.85} />
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
    const row = idx >= 0 ? Math.min(idx, MAX_L0_ROWS - 1) : 0;
    return L0_Y + row * L0_ROW_STEP + L0_H / 2;
  }
  return l1BandY(snap) + L1_H / 2;
}

function probeX(probe: ReadPath["probes"][number], key: string, snap: LsmSnapshot): number {
  if (probe.structure === "memtable") {
    return keyX(key);
  }
  if (probe.structure === "L0") {
    const table = snap.l0.find((t) => t.id === probe.tableId);
    if (!table || table.minKey === null || table.maxKey === null) return keyX(key);
    return rangeX(table.minKey) + rangeW(table.minKey, table.maxKey) / 2;
  }
  const table = snap.l1.find((t) => t.id === probe.tableId);
  if (!table || table.minKey === null || table.maxKey === null) return keyX(key);
  return rangeX(table.minKey) + rangeW(table.minKey, table.maxKey) / 2;
}

// A read path is only drawable while every SSTable it probed still exists.
// A flush/compaction after the read (e.g. via auto modes) invalidates the
// positions, so the overlay is hidden rather than drawn against wrong rows.
// The HTML trace in ReadPathPanel still reports the read textually.
function pathIsCurrent(path: ReadPath, snap: LsmSnapshot): boolean {
  return path.probes.every((p) => {
    if (p.structure === "memtable") return true;
    if (p.structure === "L0") return snap.l0.some((t) => t.id === p.tableId);
    return snap.l1.some((t) => t.id === p.tableId);
  });
}

function dotColor(probe: ReadPath["probes"][number]): string {
  if (!probe.hit) return "var(--color-dead)";
  if (probe.found === "tombstone") return "var(--color-danger)";
  return "var(--color-ok)";
}

// Probe markers pair color with shape (never color alone):
//   value hit  = ok-green filled circle
//   tombstone  = danger filled diamond
//   miss       = dead-gray circle with an X cross
function ProbeMarker({ probe, cx, cy }: { probe: ReadPath["probes"][number]; cx: number; cy: number }) {
  const color = dotColor(probe);
  if (probe.hit && probe.found === "tombstone") {
    return (
      <rect
        x={cx - 5}
        y={cy - 5}
        width={10}
        height={10}
        fill={color}
        fillOpacity={0.9}
        transform={`rotate(45 ${cx} ${cy})`}
      />
    );
  }
  if (probe.hit) {
    return <circle cx={cx} cy={cy} r={6} fill={color} fillOpacity={0.9} />;
  }
  return (
    <>
      <circle cx={cx} cy={cy} r={6} fill={color} fillOpacity={0.9} />
      <line x1={cx - 3} y1={cy - 3} x2={cx + 3} y2={cy + 3} stroke="var(--color-paper)" strokeWidth={1.5} />
      <line x1={cx + 3} y1={cy - 3} x2={cx - 3} y2={cy + 3} stroke="var(--color-paper)" strokeWidth={1.5} />
    </>
  );
}

interface Props {
  snap: LsmSnapshot;
}

export function LevelDiagram({ snap }: Props) {
  const memFill = snap.memtable.length / MEMTABLE_FLUSH_THRESHOLD;
  const memW = Math.max(4, Math.min(memFill, 1) * KEY_AXIS_W);

  const drawnL0 = snap.l0.slice(0, MAX_L0_ROWS);
  const l0BandRows = Math.max(visibleL0Rows(snap), 1);
  const usedL1Y = l1BandY(snap);
  const totalH = usedL1Y + L1_H + 20;

  const path = snap.lastReadPath && pathIsCurrent(snap.lastReadPath, snap) ? snap.lastReadPath : null;

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
        height={l0BandRows * L0_ROW_STEP + 4}
        fill="none"
        stroke={snap.compactionPressure ? "var(--color-pending)" : "var(--color-rule)"}
        strokeWidth={snap.compactionPressure ? 2 : 1}
        rx={4}
        fillOpacity={0}
      />

      {/* L0 SSTables — newest first (index 0 = newest = top row) */}
      {drawnL0.map((table, i) => (
        <TableBar
          key={table.id}
          table={table}
          y={L0_Y + i * L0_ROW_STEP}
          h={L0_H}
          fill="var(--color-entity)"
          stroke="var(--color-entity)"
        />
      ))}

      {/* Overflow marker: three dots below the last drawn L0 row when older
          files are hidden (count is reported in the HTML chips, not in SVG) */}
      {snap.l0.length > MAX_L0_ROWS && (
        <g fill="var(--color-muted)">
          <circle cx={VB_W / 2 - 14} cy={L0_Y + MAX_L0_ROWS * L0_ROW_STEP - 8} r={2.5} />
          <circle cx={VB_W / 2} cy={L0_Y + MAX_L0_ROWS * L0_ROW_STEP - 8} r={2.5} />
          <circle cx={VB_W / 2 + 14} cy={L0_Y + MAX_L0_ROWS * L0_ROW_STEP - 8} r={2.5} />
        </g>
      )}

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
              <ProbeMarker probe={probe} cx={cx} cy={cy} />
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
