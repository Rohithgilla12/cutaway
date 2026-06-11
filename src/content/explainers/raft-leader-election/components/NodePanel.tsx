import type { NodeView } from "../sim/raftSim";
import { VizButton, BTN_BASE, BTN_DISABLED } from "../../../../lib/viz";

interface Props {
  nodes: NodeView[];
  onKill: (id: number) => void;
  onRestart: (id: number) => void;
}

export function NodePanel({ nodes, onKill, onRestart }: Props) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        marginTop: 8,
        borderTop: "1px solid var(--color-rule)",
        paddingTop: 8,
      }}
    >
      {nodes.map((n) => {
        const dead = !n.alive;
        const rowColor = dead ? "var(--color-dead)" : "var(--color-ink)";
        const votedStr = n.votedFor !== null ? `voted n${n.votedFor}` : "voted —";
        const roleLabel = n.role === "dead" ? "dead" : n.role.slice(0, 1).toUpperCase() + n.role.slice(1);

        return (
          <div
            key={n.id}
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              padding: "3px 0",
              color: rowColor,
              opacity: dead ? 0.65 : 1,
            }}
          >
            <span style={{ minWidth: 128 }}>
              n{n.id} · {roleLabel} · term {n.currentTerm} · {votedStr} · log {n.log.length} · commit {n.commitIndex}
            </span>
            <VizButton
              style={{
                ...(dead ? BTN_BASE : BTN_DISABLED),
                minWidth: 70,
                minHeight: 44,
                padding: "4px 8px",
                fontSize: 10,
              }}
              disabled={!dead}
              onClick={() => onRestart(n.id)}
              title={`Restart n${n.id}`}
            >
              Restart
            </VizButton>
            <VizButton
              style={{
                ...(dead ? BTN_DISABLED : BTN_BASE),
                minWidth: 44,
                minHeight: 44,
                padding: "4px 8px",
                fontSize: 10,
              }}
              disabled={dead}
              onClick={() => onKill(n.id)}
              title={`Kill n${n.id}`}
            >
              Kill
            </VizButton>
          </div>
        );
      })}
    </div>
  );
}
