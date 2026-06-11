import type { CodeProgress, WorkerStatus } from "../sim/replaySim";

const CODE_LINES = [
  "function processOrder() {",
  "  const amount = await chargeCard();",
  "  if (amount > 100) {",
  "    await reserveInventory();",
  "  }",
  "  await sleep(5);",
  "  await sendEmail();",
  "  return complete();",
  "}",
];

interface WorkflowCodeProps {
  code: CodeProgress;
  status: WorkerStatus;
}

export function WorkflowCode({ code, status }: WorkflowCodeProps) {
  const isReplaying = status === "replaying" || status === "failed-nondeterminism";
  const activeLine = code.line;

  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        border: "1px solid var(--color-rule)",
        borderRadius: 3,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "4px 8px",
          borderBottom: "1px solid var(--color-rule)",
          fontSize: 10,
          color: "var(--color-muted)",
          background: "var(--color-raised)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>processOrder (pseudocode)</span>
        {isReplaying && (
          <span
            style={{
              color: "var(--color-pending)",
              fontWeight: 600,
              fontSize: 10,
            }}
          >
            REPLAYING
          </span>
        )}
      </div>
      <div style={{ padding: "6px 0" }}>
        {CODE_LINES.map((line, i) => {
          const lineNum = i + 1;
          const isActive = lineNum === activeLine && activeLine > 0;
          return (
            <div
              key={lineNum}
              style={{
                display: "flex",
                background: isActive ? "color-mix(in srgb, var(--color-entity) 12%, transparent)" : "transparent",
                borderLeft: isActive ? "2px solid var(--color-entity)" : "2px solid transparent",
                padding: "1px 8px 1px 6px",
              }}
            >
              <span
                style={{
                  color: "var(--color-muted)",
                  minWidth: 20,
                  textAlign: "right",
                  marginRight: 12,
                  fontSize: 10,
                  userSelect: "none",
                }}
              >
                {lineNum}
              </span>
              <span
                style={{
                  color: isActive ? "var(--color-ink)" : "var(--color-muted)",
                  fontWeight: isActive ? 600 : 400,
                  whiteSpace: "pre",
                }}
              >
                {line}
              </span>
            </div>
          );
        })}
      </div>
      {(code.amount !== null || code.reserved !== null) && (
        <div
          style={{
            padding: "6px 8px",
            borderTop: "1px solid var(--color-rule)",
            fontSize: 11,
            display: "flex",
            flexWrap: "wrap",
            gap: "4px 16px",
          }}
        >
          {code.amount !== null && (
            <span>
              <span style={{ color: "var(--color-muted)" }}>amount = </span>
              <span style={{ color: "var(--color-ink)", fontWeight: 600 }}>{code.amount}</span>
              {isReplaying && (
                <span
                  style={{
                    color: "var(--color-pending)",
                    fontSize: 10,
                    marginLeft: 4,
                  }}
                >
                  (from history)
                </span>
              )}
            </span>
          )}
          {code.reserved !== null && (
            <span>
              <span style={{ color: "var(--color-muted)" }}>reserved = </span>
              <span style={{ color: "var(--color-ink)", fontWeight: 600 }}>{String(code.reserved)}</span>
              {isReplaying && (
                <span
                  style={{
                    color: "var(--color-pending)",
                    fontSize: 10,
                    marginLeft: 4,
                  }}
                >
                  (from history)
                </span>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
