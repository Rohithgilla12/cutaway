import type { ComparisonRow, WorkerStatus } from "../sim/replaySim";

interface ComparisonStripProps {
  comparison: ComparisonRow[];
  status: WorkerStatus;
  nondeterminismError: string | null;
}

export function ComparisonStrip({ comparison, status, nondeterminismError }: ComparisonStripProps) {
  const failed = status === "failed-nondeterminism";

  if (comparison.length === 0 && !failed) {
    return (
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-muted)",
          padding: "6px 0",
        }}
      >
        (comparison available during replay)
      </div>
    );
  }

  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 28px",
          gap: "0 8px",
          marginBottom: 4,
        }}
      >
        <div style={{ color: "var(--color-muted)", fontSize: 10, fontWeight: 600 }}>history recorded</div>
        <div style={{ color: "var(--color-muted)", fontSize: 10, fontWeight: 600 }}>replay emitted</div>
        <div />
      </div>
      {comparison.map((row) => {
        const isMismatch = row.outcome === "mismatch";
        const isMatch = row.outcome === "match";
        return (
          <div
            key={row.index}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 28px",
              gap: "0 8px",
              padding: "3px 0",
              borderTop: "1px solid var(--color-rule)",
              background: isMismatch ? "color-mix(in srgb, var(--color-danger) 8%, transparent)" : "transparent",
            }}
          >
            <span
              style={{
                color: isMismatch ? "var(--color-danger)" : "var(--color-ink)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={row.recorded}
            >
              {row.recorded}
            </span>
            <span
              style={{
                color: isMismatch ? "var(--color-danger)" : "var(--color-ink)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={row.emitted}
            >
              {row.emitted}
            </span>
            <span
              style={{
                fontWeight: 700,
                color: isMismatch ? "var(--color-danger)" : isMatch ? "var(--color-ok)" : "var(--color-muted)",
                textAlign: "center",
              }}
            >
              {isMismatch ? "✕" : isMatch ? "✓" : "…"}
            </span>
          </div>
        );
      })}

      {failed && nondeterminismError && (
        <div
          aria-hidden="true"
          style={{
            marginTop: 8,
            padding: "8px 10px",
            border: "2px solid var(--color-danger)",
            borderRadius: 3,
            background: "color-mix(in srgb, var(--color-danger) 8%, transparent)",
            color: "var(--color-danger)",
            fontSize: 11,
            lineHeight: 1.5,
            wordBreak: "break-word",
          }}
        >
          {nondeterminismError}
        </div>
      )}
    </div>
  );
}
