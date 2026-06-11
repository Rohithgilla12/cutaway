import { useState } from "react";
import { intersection } from "../sim/quorum";
import { VizButton } from "../../../../lib/viz";

const N = 5;
const NODES = [0, 1, 2, 3, 4];

const CX = 180;
const CY = 150;
const RADIUS = 110;
const NODE_R = 22;

const NODE_POSITIONS: [number, number][] = NODES.map((i) => {
  const angle = (i * (2 * Math.PI)) / N - Math.PI / 2;
  return [Math.round(CX + RADIUS * Math.cos(angle)), Math.round(CY + RADIUS * Math.sin(angle))];
});

type Phase = "A" | "B" | "done";

function phaseLabel(phase: Phase, selected: Set<number>): string {
  if (phase === "A") {
    const remaining = 3 - selected.size;
    if (selected.size === 0) return "select group A — tap 3 nodes";
    return `selecting group A — ${selected.size} of 3${remaining > 0 ? ` (${remaining} more)` : ""}`;
  }
  if (phase === "B") {
    const remaining = 3 - selected.size;
    if (selected.size === 0) return "select group B — tap 3 nodes";
    return `selecting group B — ${selected.size} of 3${remaining > 0 ? ` (${remaining} more)` : ""}`;
  }
  return "done";
}

function intersectionLabel(groupA: Set<number>, groupB: Set<number>): string {
  const shared = intersection(groupA, groupB);
  const nodes = [...shared].sort((a, b) => a - b).map((n) => `n${n}`);
  if (nodes.length === 0) return "A ∩ B = {} — impossible with two majorities";
  return `A ∩ B = {${nodes.join(", ")}} — any two majorities share at least one node. That node has the term/log state that blocks a second commit.`;
}

function nodeRingColor(id: number, groupA: Set<number>, groupB: Set<number>): string | null {
  if (groupA.has(id) && groupB.has(id)) return null;
  if (groupA.has(id)) return "var(--color-entity)";
  if (groupB.has(id)) return "var(--color-pending)";
  return null;
}

function nodeFill(id: number, groupA: Set<number>, groupB: Set<number>): string {
  if (groupA.has(id) && groupB.has(id)) return "var(--color-ok)";
  return "var(--color-raised)";
}

function nodeLabel(id: number, groupA: Set<number>, groupB: Set<number>): string {
  if (groupA.has(id) && groupB.has(id)) return "✓";
  return `n${id}`;
}

function nodeLabelColor(id: number, groupA: Set<number>, groupB: Set<number>): string {
  if (groupA.has(id) && groupB.has(id)) return "var(--color-raised)";
  return "var(--color-ink)";
}

export default function QuorumViz() {
  const [phase, setPhase] = useState<Phase>("A");
  const [groupA, setGroupA] = useState<Set<number>>(new Set());
  const [groupB, setGroupB] = useState<Set<number>>(new Set());
  const [liveAnnounce, setLiveAnnounce] = useState<string>("Select group A — tap 3 nodes to form a majority.");

  function handleNodeClick(id: number) {
    if (phase === "A") {
      if (groupA.has(id)) return;
      if (groupA.size >= 3) return;
      const next = new Set(groupA);
      next.add(id);
      setGroupA(next);
      if (next.size === 3) {
        setPhase("B");
        setLiveAnnounce(
          `Group A: {${[...next]
            .sort((a, b) => a - b)
            .map((n) => `n${n}`)
            .join(", ")}}. Now select group B — tap 3 nodes.`,
        );
      } else {
        setLiveAnnounce(`Group A: ${next.size} of 3 selected.`);
      }
    } else if (phase === "B") {
      if (groupB.has(id)) return;
      if (groupB.size >= 3) return;
      const next = new Set(groupB);
      next.add(id);
      setGroupB(next);
      if (next.size === 3) {
        setPhase("done");
        setLiveAnnounce(intersectionLabel(groupA, next));
      } else {
        setLiveAnnounce(`Group B: ${next.size} of 3 selected.`);
      }
    }
  }

  function handleReset() {
    setPhase("A");
    setGroupA(new Set());
    setGroupB(new Set());
    setLiveAnnounce("Reset. Select group A — tap 3 nodes to form a majority.");
  }

  function handleSwap() {
    setPhase("A");
    const prevB = new Set(groupB);
    setGroupA(prevB);
    setGroupB(new Set());
    if (prevB.size === 3) {
      setPhase("B");
      setLiveAnnounce(
        `Group A set to previous group B: {${[...prevB]
          .sort((a, b) => a - b)
          .map((n) => `n${n}`)
          .join(", ")}}. Now select group B.`,
      );
    } else {
      setLiveAnnounce("Swapped. Select group A — tap 3 nodes.");
    }
  }

  const phaseIndicator = phaseLabel(phase, phase === "A" ? groupA : groupB);
  const showResult = phase === "done";
  const resultText = showResult ? intersectionLabel(groupA, groupB) : "";

  return (
    <div style={{ fontFamily: "var(--font-mono)", maxWidth: 360 }}>
      <div aria-live="polite" className="sr-only">
        {liveAnnounce}
      </div>

      <svg
        viewBox={`0 0 360 300`}
        width="100%"
        aria-label="Five nodes arranged in a pentagon. Tap nodes to build two majority groups and see their intersection."
        style={{ display: "block" }}
      >
        {NODES.map((id) => {
          const [nx, ny] = NODE_POSITIONS[id];
          const ring = nodeRingColor(id, groupA, groupB);
          const fill = nodeFill(id, groupA, groupB);
          const label = nodeLabel(id, groupA, groupB);
          const labelColor = nodeLabelColor(id, groupA, groupB);
          const inBoth = groupA.has(id) && groupB.has(id);
          const isSelectable =
            (phase === "A" && !groupA.has(id) && groupA.size < 3) ||
            (phase === "B" && !groupB.has(id) && groupB.size < 3);

          return (
            <g key={id}>
              {inBoth && (
                <circle
                  cx={nx}
                  cy={ny}
                  r={NODE_R + 8}
                  fill="none"
                  stroke="var(--color-ok)"
                  strokeWidth={3}
                  opacity={0.7}
                />
              )}
              {!inBoth && ring && (
                <circle cx={nx} cy={ny} r={NODE_R + 6} fill="none" stroke={ring} strokeWidth={3} opacity={0.85} />
              )}
              {groupA.has(id) && !inBoth && (
                <text
                  x={nx}
                  y={ny - NODE_R - 10}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--color-entity)"
                  fontFamily="var(--font-mono)"
                  fontWeight="600"
                >
                  A
                </text>
              )}
              {groupB.has(id) && !inBoth && (
                <text
                  x={nx}
                  y={ny - NODE_R - 10}
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--color-pending)"
                  fontFamily="var(--font-mono)"
                  fontWeight="600"
                >
                  B
                </text>
              )}
              <circle cx={nx} cy={ny} r={44} fill="transparent" stroke="none" />
              <circle
                cx={nx}
                cy={ny}
                r={NODE_R}
                fill={fill}
                stroke={inBoth ? "var(--color-ok)" : "var(--color-ink)"}
                strokeWidth={inBoth ? 2 : 1.5}
                style={{ cursor: isSelectable ? "pointer" : "default" }}
                onClick={() => handleNodeClick(id)}
                role="button"
                aria-label={`node n${id}${groupA.has(id) ? " (group A)" : ""}${groupB.has(id) ? " (group B)" : ""}${inBoth ? " (intersection)" : ""}`}
                tabIndex={isSelectable ? 0 : -1}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleNodeClick(id);
                  }
                }}
              />
              <text
                x={nx}
                y={ny}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={inBoth ? 16 : 13}
                fontWeight="600"
                fill={labelColor}
                fontFamily="var(--font-mono)"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {label}
              </text>
            </g>
          );
        })}
      </svg>

      <div
        style={{
          fontSize: 11,
          color: "var(--color-muted)",
          marginTop: 2,
          marginBottom: 8,
          letterSpacing: "0.01em",
        }}
      >
        {phaseIndicator}
      </div>

      {showResult && (
        <div
          style={{
            fontSize: 11,
            padding: "7px 10px",
            border: "1px solid var(--color-ok)",
            color: "var(--color-ink)",
            borderRadius: 3,
            marginBottom: 8,
            letterSpacing: "0.01em",
            lineHeight: 1.5,
          }}
        >
          {resultText}
        </div>
      )}

      <div style={{ display: "flex", gap: 6 }}>
        <VizButton onClick={handleReset}>Reset</VizButton>
        {phase !== "A" && groupB.size === 0 && <VizButton onClick={handleSwap}>Swap</VizButton>}
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          marginTop: 8,
          fontSize: 10,
          color: "var(--color-muted)",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: "2px solid var(--color-entity)",
            }}
          />
          group A
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              borderRadius: "50%",
              border: "2px solid var(--color-pending)",
            }}
          />
          group B
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "var(--color-ok)",
            }}
          />
          A ∩ B
        </span>
      </div>
    </div>
  );
}
