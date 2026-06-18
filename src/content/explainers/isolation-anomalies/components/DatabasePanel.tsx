import type { IsolationSnapshot, RowView, TxnId } from "../sim/isolationSim";

function renderSeen(v: number | null | undefined): string {
  if (v === undefined) return "—";
  if (v === null) return "∅"; // row not visible to this snapshot
  return String(v);
}

function RowCard({ row }: { row: RowView }) {
  const exists = !Number.isNaN(row.committedValue);
  return (
    <div
      style={{
        border: "1px solid var(--color-rule)",
        borderRadius: 3,
        padding: "5px 8px",
        minWidth: 110,
        background: row.lockedBy ? "var(--color-paper)" : "var(--color-raised)",
        outline: row.lockedBy ? "1px solid var(--color-pending)" : "none",
      }}
      title={row.lockedBy ? `locked by ${row.lockedBy} (uncommitted write)` : undefined}
    >
      <div style={{ fontSize: 10, color: "var(--color-muted)", whiteSpace: "nowrap" }}>{row.label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: "var(--color-ink)" }}>
          {exists ? row.committedValue : "—"}
        </span>
        {row.lockedBy && (
          <span style={{ fontSize: 9, color: "var(--color-pending)", fontWeight: 600 }}>🔒 {row.lockedBy}</span>
        )}
      </div>
      <div style={{ fontSize: 9, color: "var(--color-muted)", marginTop: 2 }}>
        T1 sees {renderSeen(row.seenBy.T1)} · T2 sees {renderSeen(row.seenBy.T2)}
      </div>
    </div>
  );
}

export function DatabasePanel({ snap }: { snap: IsolationSnapshot }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: "var(--color-muted)",
          letterSpacing: "0.05em",
          marginBottom: 4,
        }}
      >
        COMMITTED DATABASE
        {snap.predicateLabel && (
          <span style={{ marginLeft: 12 }}>
            {snap.predicateLabel}:{" "}
            {(["T1", "T2"] as TxnId[])
              .filter((id) => snap.predicateValues[id] !== undefined)
              .map((id) => `${id}=${snap.predicateValues[id]}`)
              .join("  ") || "—"}
          </span>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {snap.rows.map((r) => (
          <RowCard key={r.id} row={r} />
        ))}
      </div>
    </div>
  );
}
