import type { TreeNodeView } from "../sim/btreeSim";
import { LEAF_CAP } from "../sim/btreeSim";

const LEVEL_H = 76;
const LEAF_W = 132;
const NODE_Y0 = 16;

interface Placed {
  node: TreeNodeView;
  x: number;
  y: number;
}

interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function layout(root: TreeNodeView): { placed: Placed[]; edges: Edge[]; width: number; height: number } {
  const placed: Placed[] = [];
  const edges: Edge[] = [];
  let leafCursor = 0;
  let maxDepth = 0;

  function assignX(node: TreeNodeView, depth: number): number {
    maxDepth = Math.max(maxDepth, depth);
    let x: number;
    if (node.leaf || !node.children || node.children.length === 0) {
      x = leafCursor * LEAF_W + LEAF_W / 2;
      leafCursor += 1;
    } else {
      const childXs = node.children.map((c) => assignX(c, depth + 1));
      x = (childXs[0] + childXs[childXs.length - 1]) / 2;
    }
    const y = NODE_Y0 + depth * LEVEL_H;
    placed.push({ node, x, y });
    return x;
  }

  assignX(root, 0);
  // second pass for edges (parent center-bottom → child center-top)
  const byNode = new Map(placed.map((p) => [p.node, p]));
  function wire(node: TreeNodeView): void {
    if (node.leaf || !node.children) return;
    const p = byNode.get(node)!;
    for (const c of node.children) {
      const cp = byNode.get(c)!;
      edges.push({ x1: p.x, y1: p.y + 18, x2: cp.x, y2: cp.y - 6 });
      wire(c);
    }
  }
  wire(root);

  return { placed, edges, width: Math.max(leafCursor * LEAF_W, LEAF_W), height: NODE_Y0 + (maxDepth + 1) * LEVEL_H };
}

function fillColor(pct: number): string {
  if (pct >= 80) return "var(--color-ok)";
  if (pct >= 55) return "var(--color-pending)";
  return "var(--color-danger)";
}

function LeafBox({ p }: { p: Placed }) {
  const { node, x, y } = p;
  const chipW = 20;
  const totalW = LEAF_CAP * chipW + 8;
  const left = x - totalW / 2;
  return (
    <g>
      <rect
        x={left}
        y={y}
        width={totalW}
        height={34}
        rx={3}
        fill="var(--color-raised)"
        stroke={node.justSplit ? "var(--color-entity)" : "var(--color-rule)"}
        strokeWidth={node.justSplit ? 2 : 1}
      />
      {Array.from({ length: LEAF_CAP }).map((_, i) => {
        const k = node.keys[i];
        const cx = left + 4 + i * chipW;
        return (
          <g key={i}>
            <rect x={cx} y={y + 4} width={chipW - 3} height={16} rx={2} fill={k !== undefined ? "var(--color-paper)" : "transparent"} stroke={k !== undefined ? "var(--color-rule)" : "var(--color-rule)"} strokeDasharray={k === undefined ? "2 2" : undefined} />
            {k !== undefined && (
              <text x={cx + (chipW - 3) / 2} y={y + 15} textAnchor="middle" fontSize={9} fill="var(--color-ink)">
                {k}
              </text>
            )}
          </g>
        );
      })}
      {/* fill bar */}
      <rect x={left} y={y + 26} width={totalW} height={4} fill="var(--color-rule)" />
      <rect x={left} y={y + 26} width={(totalW * node.fillPct) / 100} height={4} fill={fillColor(node.fillPct)} />
    </g>
  );
}

function InternalBox({ p }: { p: Placed }) {
  const { node, x, y } = p;
  const label = node.keys.join(" · ");
  const w = Math.max(28, label.length * 7 + 12);
  return (
    <g>
      <rect
        x={x - w / 2}
        y={y - 6}
        width={w}
        height={22}
        rx={3}
        fill="var(--color-ink)"
        stroke={node.justSplit ? "var(--color-entity)" : "var(--color-ink)"}
        strokeWidth={node.justSplit ? 2 : 1}
      />
      <text x={x} y={y + 8} textAnchor="middle" fontSize={9} fill="var(--color-raised)" fontWeight={600}>
        {label}
      </text>
    </g>
  );
}

export function BTreeDiagram({ root }: { root: TreeNodeView }) {
  const { placed, edges, width, height } = layout(root);
  return (
    <div style={{ overflowX: "auto" }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        style={{ minWidth: Math.min(width, 320), maxWidth: width, display: "block" }}
        role="img"
        aria-label={`B+tree with ${placed.filter((p) => p.node.leaf).length} leaves`}
      >
        {edges.map((e, i) => (
          <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="var(--color-rule)" strokeWidth={1} />
        ))}
        {placed.map((p) => (p.node.leaf ? <LeafBox key={p.node.id} p={p} /> : <InternalBox key={p.node.id} p={p} />))}
      </svg>
    </div>
  );
}
