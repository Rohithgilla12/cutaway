import { useCallback, useRef, useState } from "react";
import { backendCost } from "../sim/backendCost";
import { BTN_BASE } from "../../../../lib/viz";

const WORK_MEM_OPTIONS = [1, 4, 16] as const;
type WorkMemMB = (typeof WORK_MEM_OPTIONS)[number];

const RAM_REFS = [
  { label: "16 GB RAM", mb: 16 * 1024 },
  { label: "64 GB RAM", mb: 64 * 1024 },
] as const;

function fmtMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function barWidth(valueMB: number, totalCapacityMB: number): string {
  return `${Math.min(100, (valueMB / totalCapacityMB) * 100).toFixed(2)}%`;
}

const DEBOUNCE_MS = 300;

export default function BackendCostViz() {
  const [connections, setConnections] = useState(200);
  const [workMemMB, setWorkMemMB] = useState<WorkMemMB>(4);
  const [announcement, setAnnouncement] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleAnnouncement = useCallback((msg: string) => {
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setAnnouncement(msg);
    }, DEBOUNCE_MS);
  }, []);

  const handleConnections = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const n = Number(e.target.value);
      setConnections(n);
      scheduleAnnouncement(`connections: ${n}`);
    },
    [scheduleAnnouncement],
  );

  const handleWorkMem = useCallback(
    (mb: WorkMemMB) => {
      setWorkMemMB(mb);
      scheduleAnnouncement(`work_mem: ${mb} MB`);
    },
    [scheduleAnnouncement],
  );

  const result = backendCost(connections, { workMemMB });

  const capacityMB = RAM_REFS[RAM_REFS.length - 1].mb * 1.2;

  const pooledConnections = Math.ceil(connections / 8);
  const pooledResult = backendCost(pooledConnections, { workMemMB });

  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {/* Controls */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          marginBottom: 16,
          alignItems: "flex-start",
        }}
      >
        <div style={{ flex: "1 1 200px" }}>
          <label
            htmlFor="connections-slider"
            style={{ display: "block", color: "var(--color-muted)", fontSize: 10, marginBottom: 4 }}
          >
            connections
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              id="connections-slider"
              type="range"
              min={10}
              max={5000}
              step={10}
              value={connections}
              onChange={handleConnections}
              style={{ flex: 1, minWidth: 100, cursor: "pointer", accentColor: "var(--color-ink)" }}
            />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--color-ink)",
                minWidth: 48,
                textAlign: "right",
              }}
            >
              {connections}
            </span>
          </div>
        </div>

        <div>
          <span style={{ display: "block", color: "var(--color-muted)", fontSize: 10, marginBottom: 4 }}>work_mem</span>
          <div style={{ display: "flex", gap: 4 }}>
            {WORK_MEM_OPTIONS.map((mb) => (
              <button
                key={mb}
                style={{
                  ...BTN_BASE,
                  padding: "4px 10px",
                  minHeight: 44,
                  fontSize: 12,
                  background: workMemMB === mb ? "var(--color-ink)" : "var(--color-raised)",
                  color: workMemMB === mb ? "var(--color-raised)" : "var(--color-ink)",
                }}
                aria-pressed={workMemMB === mb}
                onClick={() => handleWorkMem(mb)}
              >
                {mb} MB
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main bars — unpooled */}
      <div style={{ marginBottom: 4 }}>
        <div style={{ color: "var(--color-muted)", fontSize: 10, marginBottom: 6 }}>
          {connections} backends (unpooled)
        </div>
        <MemoryBar
          baselineMB={result.baselineMB}
          workMemMB={result.workMemWorstCaseMB}
          totalMB={result.totalMB}
          capacityMB={capacityMB}
          ramRefs={RAM_REFS}
        />
      </div>

      {/* Pooled comparison row */}
      <div style={{ marginTop: 16, marginBottom: 4 }}>
        <div style={{ color: "var(--color-muted)", fontSize: 10, marginBottom: 6 }}>
          pooled: {connections} clients → ~{pooledConnections} server connections (8 clients per server conn.)
        </div>
        <MemoryBar
          baselineMB={pooledResult.baselineMB}
          workMemMB={pooledResult.workMemWorstCaseMB}
          totalMB={pooledResult.totalMB}
          capacityMB={capacityMB}
          ramRefs={RAM_REFS}
        />
      </div>

      {/* Summary numbers */}
      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "4px 16px",
          padding: "8px 4px",
          borderTop: "1px solid var(--color-rule)",
        }}
      >
        <NumberStat label="baseline (est.)" value={fmtMB(result.baselineMB)} />
        <NumberStat label="work_mem worst (est.)" value={fmtMB(result.workMemWorstCaseMB)} />
        <NumberStat label="total (est.)" value={fmtMB(result.totalMB)} danger={result.totalMB > 64 * 1024} />
        <NumberStat label="pooled total (est.)" value={fmtMB(pooledResult.totalMB)} />
      </div>

      {/* Legend */}
      <div
        style={{
          marginTop: 8,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          fontSize: 10,
          color: "var(--color-muted)",
        }}
      >
        <LegendChip color="var(--color-entity)" label="baseline ~5–10 MB/backend (est.)" />
        <LegendChip color="var(--color-pending)" label="work_mem worst case (est.)" />
      </div>
    </div>
  );
}

interface MemoryBarProps {
  baselineMB: number;
  workMemMB: number;
  totalMB: number;
  capacityMB: number;
  ramRefs: ReadonlyArray<{ label: string; mb: number }>;
}

function MemoryBar({ baselineMB, workMemMB, totalMB, capacityMB, ramRefs }: MemoryBarProps) {
  return (
    <div style={{ position: "relative" }}>
      {/* RAM reference lines (behind bars) */}
      {ramRefs.map(({ label, mb }) => {
        const pct = `${((mb / capacityMB) * 100).toFixed(2)}%`;
        return (
          <div
            key={label}
            style={{
              position: "absolute",
              left: pct,
              top: 0,
              bottom: 0,
              width: 1,
              background: "var(--color-rule)",
              zIndex: 1,
            }}
            aria-hidden="true"
          />
        );
      })}

      {/* Stacked bar track */}
      <div
        role="img"
        aria-label={`Memory estimate: ${fmtMB(totalMB)} total — ${fmtMB(baselineMB)} baseline, ${fmtMB(workMemMB)} work_mem worst case`}
        style={{
          position: "relative",
          height: 32,
          background: "var(--color-paper)",
          border: "1px solid var(--color-rule)",
          borderRadius: 3,
          overflow: "hidden",
          display: "flex",
        }}
      >
        <div
          style={{
            width: barWidth(baselineMB, capacityMB),
            background: "var(--color-entity)",
            opacity: 0.75,
            transition: "width 120ms ease-out",
            flexShrink: 0,
          }}
        />
        <div
          style={{
            width: barWidth(workMemMB, capacityMB),
            background: "var(--color-pending)",
            opacity: 0.75,
            transition: "width 120ms ease-out",
            flexShrink: 0,
          }}
        />
      </div>

      {/* RAM reference labels (above bar) */}
      <div style={{ position: "relative", height: 16, marginTop: 2 }}>
        {ramRefs.map(({ label, mb }) => {
          const pct = `${((mb / capacityMB) * 100).toFixed(2)}%`;
          return (
            <span
              key={label}
              style={{
                position: "absolute",
                left: pct,
                transform: "translateX(-50%)",
                fontSize: 9,
                color: "var(--color-muted)",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

interface NumberStatProps {
  label: string;
  value: string;
  danger?: boolean;
}

function NumberStat({ label, value, danger }: NumberStatProps) {
  return (
    <div>
      <span style={{ color: "var(--color-muted)", fontSize: 10 }}>{label} </span>
      <span
        style={{
          color: danger ? "var(--color-danger)" : "var(--color-ink)",
          fontWeight: 600,
          fontSize: 11,
        }}
      >
        {value}
      </span>
    </div>
  );
}

interface LegendChipProps {
  color: string;
  label: string;
}

function LegendChip({ color, label }: LegendChipProps) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          background: color,
          opacity: 0.75,
          borderRadius: 2,
          flexShrink: 0,
        }}
      />
      {label}
    </span>
  );
}
