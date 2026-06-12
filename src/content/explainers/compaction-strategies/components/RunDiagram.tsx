import type { CompactionSnapshot, RunView } from "../sim/compactionSim";
import { LEVEL_TARGETS, MAX_LEVEL, MEMTABLE_FLUSH_THRESHOLD } from "../sim/compactionSim";

const MAX_DRAWN_RUNS = 12;
const PX_PER_ENTRY = 3;

function RunBar({ run }: { run: RunView }) {
  const color = run.beingCompacted ? "var(--color-pending)" : "var(--color-entity)";
  return (
    <div
      style={{
        width: Math.max(18, run.size * PX_PER_ENTRY),
        height: 18,
        border: `1px solid ${color}`,
        borderStyle: run.beingCompacted ? "dashed" : "solid",
        color,
        borderRadius: 2,
        fontSize: 9,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "nowrap",
        overflow: "hidden",
        flexShrink: 0,
      }}
      title={`run ${run.id}: ${run.size} entries${run.beingCompacted ? " — input of the running compaction" : ""}`}
    >
      {run.size}
    </div>
  );
}

export function RunDiagram({ snap }: { snap: CompactionSnapshot }) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {/* memtable row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 70, flexShrink: 0, fontSize: 10, color: "var(--color-muted)" }}>MEMTABLE</span>
        <div
          style={{
            width: Math.max(18, snap.memtableSize * PX_PER_ENTRY),
            height: 18,
            border: "1px solid var(--color-ok)",
            color: "var(--color-ok)",
            borderRadius: 2,
            fontSize: 9,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title={`memtable: ${snap.memtableSize}/${MEMTABLE_FLUSH_THRESHOLD} entries`}
        >
          {snap.memtableSize}/{MEMTABLE_FLUSH_THRESHOLD}
        </div>
      </div>

      {snap.levels.map((runs, i) => {
        const size = runs.reduce((s, r) => s + r.size, 0);
        const target = LEVEL_TARGETS[i];
        const overTarget = i > 0 && i < MAX_LEVEL && size > target;
        const drawn = runs.slice(0, MAX_DRAWN_RUNS);
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 20 }}>
            <span
              style={{
                width: 70,
                flexShrink: 0,
                fontSize: 10,
                color: overTarget ? "var(--color-pending)" : "var(--color-muted)",
              }}
            >
              L{i} {runs.length > 0 ? `·${runs.length}r` : ""}
              {i > 0 && i < MAX_LEVEL ? ` ${size}/${target}` : ""}
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center", minWidth: 0 }}>
              {drawn.map((r) => (
                <RunBar key={r.id} run={r} />
              ))}
              {runs.length > MAX_DRAWN_RUNS && (
                <span style={{ fontSize: 9, color: "var(--color-muted)" }}>+{runs.length - MAX_DRAWN_RUNS} runs</span>
              )}
              {runs.length === 0 && <span style={{ fontSize: 9, color: "var(--color-rule)" }}>—</span>}
            </div>
          </div>
        );
      })}

      {snap.job && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 70, flexShrink: 0, fontSize: 10, color: "var(--color-pending)" }}>MERGING</span>
          <div
            style={{
              width: Math.max(18, snap.job.outputSize * PX_PER_ENTRY),
              height: 12,
              border: "1px solid var(--color-pending)",
              borderRadius: 2,
              position: "relative",
              overflow: "hidden",
              flexShrink: 1,
              maxWidth: "100%",
            }}
            title={`compaction -> L${snap.job.targetLevel}: ${Math.floor(snap.job.writtenSoFar)}/${snap.job.outputSize} entries written`}
          >
            <div
              style={{
                position: "absolute",
                inset: 0,
                width: `${(100 * snap.job.writtenSoFar) / snap.job.outputSize}%`,
                background: "var(--color-pending)",
                opacity: 0.5,
              }}
            />
          </div>
          <span style={{ fontSize: 9, color: "var(--color-muted)", whiteSpace: "nowrap" }}>
            → L{snap.job.targetLevel}
          </span>
        </div>
      )}
    </div>
  );
}
