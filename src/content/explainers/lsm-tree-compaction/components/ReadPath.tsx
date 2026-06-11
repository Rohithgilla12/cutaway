import type { ReadPath as ReadPathData } from "../sim/lsmSim";

interface Props {
  path: ReadPathData | null;
}

// HTML trace of the last read's probe descent. The readAmp numbers themselves
// live in the stats grid in LsmViz — this panel is only the per-probe trace.
export function ReadPathPanel({ path }: Props) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        marginTop: 6,
        padding: "6px 8px",
        background: "var(--color-raised)",
        border: "1px solid var(--color-rule)",
        borderRadius: 3,
      }}
    >
      {path && (
        <div>
          <span style={{ color: "var(--color-muted)", fontSize: 10 }}>read {path.key} → </span>
          <span
            style={{
              color: path.outcome === "value" ? "var(--color-ok)" : "var(--color-muted)",
              fontWeight: 600,
              fontSize: 10,
            }}
          >
            {path.outcome === "value" ? `${path.key}=${path.value}` : "not found"}
          </span>
          <span style={{ color: "var(--color-muted)", fontSize: 10 }}>
            {" "}
            · {path.readAmplification} probe{path.readAmplification === 1 ? "" : "s"}
          </span>
          <div
            style={{
              marginTop: 4,
              display: "flex",
              flexWrap: "wrap",
              gap: "2px 0",
              flexDirection: "column",
            }}
          >
            {path.probes.map((probe, i) => {
              const label = probe.structure === "memtable" ? "memtable" : `${probe.structure}-${probe.tableId}`;
              let statusColor = "var(--color-muted)";
              let statusText = "miss";
              if (probe.hit && probe.found === "value") {
                statusColor = "var(--color-ok)";
                statusText = `HIT ${path.key}=${path.value}`;
              } else if (probe.hit && probe.found === "tombstone") {
                statusColor = "var(--color-danger)";
                statusText = "HIT tombstone (deleted)";
              }
              return (
                <span key={i} style={{ fontSize: 10, color: "var(--color-muted)" }}>
                  <span style={{ color: "var(--color-ink)" }}>{i + 1} </span>
                  <span>{label} </span>
                  <span style={{ color: statusColor }}>— {statusText}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {!path && <div style={{ color: "var(--color-muted)", fontSize: 10 }}>press Read to trace a path</div>}
    </div>
  );
}
