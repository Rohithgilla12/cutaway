import { useState } from "react";
import type React from "react";
import type { RaftSnapshot, NodeView, LinkView, MessageView, Role } from "../sim/raftSim";

const VIEW_W = 700;
const VIEW_H = 360;
const CX = 350;
const CY = 175;
const RADIUS = 130;
const NODE_R = 28;

const NODE_POSITIONS: [number, number][] = [0, 1, 2, 3, 4].map((i) => {
  const angle = (i * (2 * Math.PI)) / 5 - Math.PI / 2;
  return [Math.round(CX + RADIUS * Math.cos(angle)), Math.round(CY + RADIUS * Math.sin(angle))];
});

function roleFill(role: Role): string {
  switch (role) {
    case "leader":
      return "var(--color-entity)";
    case "candidate":
      return "var(--color-pending)";
    case "dead":
      return "var(--color-dead)";
    default:
      return "var(--color-raised)";
  }
}

function roleStroke(role: Role): string {
  switch (role) {
    case "dead":
      return "var(--color-dead)";
    default:
      return "var(--color-ink)";
  }
}

function roleLabelColor(role: Role): string {
  switch (role) {
    case "leader":
    case "candidate":
      return "var(--color-raised)";
    default:
      return "var(--color-ink)";
  }
}

function roleGlyph(role: Role): string {
  switch (role) {
    case "leader":
      return "L";
    case "candidate":
      return "C";
    case "dead":
      return "✕";
    default:
      return "F";
  }
}

function msgColor(kind: MessageView["kind"]): string {
  switch (kind) {
    case "RequestVote":
      return "var(--color-pending)";
    case "RequestVoteReply":
      return "var(--color-ok)";
    case "AppendEntries":
    case "AppendEntriesReply":
      return "var(--color-entity)";
  }
}

interface TimerArcProps {
  cx: number;
  cy: number;
  r: number;
  pct: number;
}

function TimerArc({ cx, cy, r, pct }: TimerArcProps) {
  if (pct <= 0) return null;
  const outerR = r + 5;
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + pct * 2 * Math.PI;
  const x1 = cx + outerR * Math.cos(startAngle);
  const y1 = cy + outerR * Math.sin(startAngle);
  const x2 = cx + outerR * Math.cos(endAngle);
  const y2 = cy + outerR * Math.sin(endAngle);
  const largeArc = pct > 0.5 ? 1 : 0;
  const d = `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`;
  return <path d={d} fill="none" stroke="var(--color-pending)" strokeWidth={3} strokeLinecap="round" opacity={0.7} />;
}

interface NodeCircleProps {
  node: NodeView;
  onNodeClick: (id: number) => void;
  focused: boolean;
  onFocus: (key: string) => void;
  onBlur: () => void;
}

function NodeCircle({ node, onNodeClick, focused, onFocus, onBlur }: NodeCircleProps) {
  const [nx, ny] = NODE_POSITIONS[node.id];
  const fill = roleFill(node.role);
  const stroke = roleStroke(node.role);
  const labelColor = roleLabelColor(node.role);
  const glyph = roleGlyph(node.role);
  const action = node.role === "dead" ? "restart" : "kill";
  const focusKey = `node-${node.id}`;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onNodeClick(node.id);
    }
  };

  return (
    <g
      onClick={() => onNodeClick(node.id)}
      onKeyDown={handleKeyDown}
      onFocus={() => onFocus(focusKey)}
      onBlur={onBlur}
      tabIndex={0}
      style={{ cursor: "pointer", outline: "none" }}
      role="button"
      aria-label={`node n${node.id} — ${action}`}
    >
      {node.role !== "dead" && node.role !== "leader" && <TimerArc cx={nx} cy={ny} r={NODE_R} pct={node.timerPct} />}
      {focused && (
        <circle
          cx={nx}
          cy={ny}
          r={NODE_R + 6}
          fill="none"
          stroke="var(--color-entity)"
          strokeWidth={3}
          opacity={0.8}
        />
      )}
      <circle cx={nx} cy={ny} r={43} fill="transparent" stroke="none" />
      <circle
        cx={nx}
        cy={ny}
        r={NODE_R}
        fill={fill}
        stroke={stroke}
        strokeWidth={node.role === "follower" ? 2 : 0}
        opacity={node.role === "dead" ? 0.5 : 1}
      />
      <text
        x={nx}
        y={ny}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={26}
        fontWeight="600"
        fill={labelColor}
        fontFamily="var(--font-mono)"
        opacity={node.role === "dead" ? 0.6 : 1}
      >
        {glyph}
      </text>
    </g>
  );
}

interface LinkLineProps {
  link: LinkView;
  onLinkClick: (a: number, b: number) => void;
  focused: boolean;
  onFocus: (key: string) => void;
  onBlur: () => void;
}

function LinkLine({ link, onLinkClick, focused, onFocus, onBlur }: LinkLineProps) {
  const [ax, ay] = NODE_POSITIONS[link.a];
  const [bx, by] = NODE_POSITIONS[link.b];

  const strokeColor = link.up ? "var(--color-rule)" : "var(--color-dead)";
  const dashArray = link.up ? undefined : "6,4";
  const action = link.up ? "cut" : "heal";
  const focusKey = `link-${link.a}-${link.b}`;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onLinkClick(link.a, link.b);
    }
  };

  return (
    <g
      onClick={() => onLinkClick(link.a, link.b)}
      onKeyDown={handleKeyDown}
      onFocus={() => onFocus(focusKey)}
      onBlur={onBlur}
      tabIndex={0}
      style={{ cursor: "pointer", outline: "none" }}
      role="button"
      aria-label={`link n${link.a}–n${link.b} — ${action}`}
    >
      {focused && (
        <line
          x1={ax}
          y1={ay}
          x2={bx}
          y2={by}
          stroke="var(--color-entity)"
          strokeWidth={5}
          opacity={0.6}
        />
      )}
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke="transparent" strokeWidth={84} />
      <line
        x1={ax}
        y1={ay}
        x2={bx}
        y2={by}
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeDasharray={dashArray}
        opacity={link.up ? 1 : 0.6}
      />
    </g>
  );
}

interface MessageDotProps {
  msg: MessageView;
}

function MessageDot({ msg }: MessageDotProps) {
  const [ax, ay] = NODE_POSITIONS[msg.from];
  const [bx, by] = NODE_POSITIONS[msg.to];
  const t = msg.progress;
  const x = ax + (bx - ax) * t;
  const y = ay + (by - ay) * t;
  const color = msgColor(msg.kind);

  return <circle key={msg.id} cx={x} cy={y} r={5} fill={color} opacity={0.9} />;
}

interface Props {
  snap: RaftSnapshot;
  onNodeClick: (id: number) => void;
  onLinkClick: (a: number, b: number) => void;
}

export function ClusterGraph({ snap, onNodeClick, onLinkClick }: Props) {
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  return (
    <>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        width="100%"
        aria-label="Raft cluster — 5 nodes in a pentagon. Click or press Enter/Space on a node to kill or restart it. Click or press Enter/Space on a link to cut or heal it."
        style={{ display: "block" }}
      >
        {snap.links.map((link) => (
          <LinkLine
            key={`${link.a}-${link.b}`}
            link={link}
            onLinkClick={onLinkClick}
            focused={focusedKey === `link-${link.a}-${link.b}`}
            onFocus={setFocusedKey}
            onBlur={() => setFocusedKey(null)}
          />
        ))}

        {snap.messages.map((msg) => (
          <MessageDot key={msg.id} msg={msg} />
        ))}

        {snap.nodes.map((node) => (
          <NodeCircle
            key={node.id}
            node={node}
            onNodeClick={onNodeClick}
            focused={focusedKey === `node-${node.id}`}
            onFocus={setFocusedKey}
            onBlur={() => setFocusedKey(null)}
          />
        ))}
      </svg>
      <p
        style={{
          fontSize: 10,
          color: "var(--color-muted)",
          margin: "2px 0 0",
          fontFamily: "var(--font-mono)",
        }}
      >
        clockwise from top: n0 · n1 · n2 · n3 · n4
      </p>
    </>
  );
}
