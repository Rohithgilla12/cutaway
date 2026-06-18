import type { TxnView, TxnId } from "../sim/isolationSim";
import { VizButton } from "../../../../lib/viz";

const STATUS_COLOR: Record<TxnView["status"], string> = {
  active: "var(--color-entity)",
  blocked: "var(--color-pending)",
  committed: "var(--color-ok)",
  aborted: "var(--color-danger)",
};

const OP_STATE_COLOR: Record<TxnView["ops"][number]["state"], string> = {
  pending: "var(--color-muted)",
  current: "var(--color-ink)",
  done: "var(--color-ink)",
  blocked: "var(--color-pending)",
  failed: "var(--color-danger)",
};

function statusText(t: TxnView): string {
  if (t.status === "blocked") return `blocked on ${t.blockedOn}`;
  if (t.status === "aborted") return "aborted (40001)";
  if (t.status === "committed") return "committed";
  return "active";
}

interface Props {
  txn: TxnView;
  accent: string;
  onStep: () => void;
}

export function TxnColumn({ txn, accent, onStep }: Props) {
  const statusColor = STATUS_COLOR[txn.status];
  return (
    <div
      style={{
        flex: "1 1 200px",
        minWidth: 0,
        border: `1px solid var(--color-rule)`,
        borderTop: `2px solid ${accent}`,
        borderRadius: 3,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "5px 8px",
          borderBottom: "1px solid var(--color-rule)",
        }}
      >
        <span style={{ fontWeight: 700, color: accent, fontSize: 12 }}>{txn.id}</span>
        <span style={{ fontSize: 9, color: statusColor, fontWeight: 600, letterSpacing: "0.03em" }}>
          {statusText(txn)}
          {txn.snapshotCommitId !== null && (
            <span style={{ color: "var(--color-muted)", fontWeight: 400 }}> · snap ≤ {txn.snapshotCommitId}</span>
          )}
        </span>
      </div>

      <ol style={{ listStyle: "none", margin: 0, padding: "6px 8px", fontSize: 11, lineHeight: 1.5 }}>
        {txn.ops.map((op, i) => {
          const color = OP_STATE_COLOR[op.state];
          const isCurrent = op.state === "current";
          return (
            <li
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "2px 4px",
                marginBottom: 2,
                borderLeft: `2px solid ${isCurrent ? accent : "transparent"}`,
                background: isCurrent ? "var(--color-paper)" : "transparent",
                opacity: op.state === "pending" ? 0.5 : 1,
              }}
            >
              <span style={{ color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {isCurrent ? "▸ " : "  "}
                {op.text}
              </span>
              {op.detail && (
                <span
                  style={{
                    fontSize: 10,
                    color: op.state === "failed" ? "var(--color-danger)" : "var(--color-muted)",
                    paddingLeft: 12,
                  }}
                >
                  {op.detail}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div style={{ marginTop: "auto", padding: "4px 8px 8px" }}>
        <VizButton
          variant={txn.canStep ? "primary" : "default"}
          disabled={!txn.canStep}
          onClick={onStep}
          style={{ width: "100%", minHeight: 36 }}
          title={txn.canStep ? `Run ${txn.id}'s next statement` : `${txn.id} cannot advance`}
        >
          {txn.status === "blocked" ? `${txn.id} waiting…` : `Run ${txn.id} ▸`}
        </VizButton>
      </div>
    </div>
  );
}

// Both transactions share the entity hue; the bold T1/T2 labels, column
// position, and live status colors carry their identity (the site has no
// second accent token, and adding one for one explainer is a platform change).
export const TXN_ACCENT: Record<TxnId, string> = {
  T1: "var(--color-entity)",
  T2: "var(--color-entity)",
};
