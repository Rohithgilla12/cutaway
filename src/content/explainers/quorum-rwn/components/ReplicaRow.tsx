import type { QuorumSnapshot, HomeNodeView, StandinView } from "../sim/quorumSim";

function NodeBox({
  node,
  inOverlap,
  onClick,
}: {
  node: HomeNodeView;
  inOverlap: boolean;
  onClick: () => void;
}) {
  const borderColor = !node.reachable
    ? "var(--color-dead)"
    : inOverlap
      ? "var(--color-ok)"
      : node.lastWriteTarget
        ? "var(--color-ok)"
        : node.lastReadResponder
          ? "var(--color-entity)"
          : "var(--color-rule)";
  return (
    <button
      onClick={onClick}
      title={node.reachable ? `replica ${node.id} — click to partition` : `replica ${node.id} (partitioned) — click to heal`}
      style={{
        position: "relative",
        width: 60,
        minHeight: 60,
        padding: "6px 4px 4px",
        background: "var(--color-raised)",
        border: `2px solid ${borderColor}`,
        borderStyle: node.reachable ? "solid" : "dashed",
        borderRadius: 4,
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        opacity: node.reachable ? 1 : 0.5,
        flex: "0 0 auto",
      }}
    >
      <div style={{ fontSize: 8, color: "var(--color-muted)" }}>replica {node.id}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--color-ink)" }}>{node.value}</div>
      <div style={{ fontSize: 8, color: "var(--color-muted)" }}>ver {node.version}</div>
      <div style={{ position: "absolute", top: 2, right: 3, display: "flex", gap: 2 }}>
        {node.lastWriteTarget && <span style={{ fontSize: 8, fontWeight: 700, color: "var(--color-ok)" }}>W</span>}
        {node.lastReadResponder && <span style={{ fontSize: 8, fontWeight: 700, color: "var(--color-entity)" }}>R</span>}
      </div>
      {node.repaired && (
        <div style={{ position: "absolute", bottom: 2, right: 3, fontSize: 7, color: "var(--color-pending)" }} title="updated by read repair">
          ↻
        </div>
      )}
      {!node.reachable && (
        <div style={{ position: "absolute", top: 2, left: 3, fontSize: 9, color: "var(--color-danger)" }}>✕</div>
      )}
    </button>
  );
}

function StandinBox({ s, onClick }: { s: StandinView; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={s.reachable ? `stand-in ${s.id} — click to partition` : `stand-in ${s.id} (down)`}
      style={{
        width: 60,
        minHeight: 60,
        padding: "6px 4px 4px",
        background: "var(--color-paper)",
        border: `1.5px dashed ${s.holding ? "var(--color-pending)" : "var(--color-rule)"}`,
        borderRadius: 4,
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        opacity: s.reachable ? 1 : 0.5,
        flex: "0 0 auto",
      }}
    >
      <div style={{ fontSize: 8, color: "var(--color-muted)" }}>stand-in {s.id}</div>
      {s.holding ? (
        <>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--color-pending)" }}>{s.holding.value}</div>
          <div style={{ fontSize: 7, color: "var(--color-muted)" }}>hint → {s.holding.forNodeId}</div>
        </>
      ) : (
        <div style={{ fontSize: 10, color: "var(--color-muted)", marginTop: 10 }}>idle</div>
      )}
    </button>
  );
}

interface Props {
  snap: QuorumSnapshot;
  onTogglePartition: (id: number) => void;
  onToggleStandin: (id: number) => void;
}

export function ReplicaRow({ snap, onTogglePartition, onToggleStandin }: Props) {
  const overlap = new Set(snap.overlap);
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--color-muted)", letterSpacing: "0.05em", marginBottom: 4 }}>
        {snap.n} REPLICAS (click to partition / heal)
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {snap.home.map((node) => (
          <NodeBox key={node.id} node={node} inOverlap={overlap.has(node.id)} onClick={() => onTogglePartition(node.id)} />
        ))}
      </div>

      {snap.sloppy && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: "var(--color-muted)", letterSpacing: "0.05em", marginBottom: 4 }}>
            STAND-INS (hinted handoff)
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {snap.standins.map((s) => (
              <StandinBox key={s.id} s={s} onClick={() => onToggleStandin(s.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
