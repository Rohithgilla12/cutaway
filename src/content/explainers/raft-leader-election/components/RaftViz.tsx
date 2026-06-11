import { useCallback, useEffect, useRef, useState } from "react";
import { createRaftSim } from "../sim/raftSim";
import type { RaftSim, RaftSnapshot } from "../sim/raftSim";
import { ClusterGraph } from "./ClusterGraph";
import { NodePanel } from "./NodePanel";
import { RaftControls } from "./RaftControls";
import { useReducedMotion, useSimLoop, Legend, Stat, EventLog } from "../../../../lib/viz";

const SEED = 0xdead_beef;

// m1: two-instance pattern — simRef owns live state; second instance provides
// the lazy initial snapshot without reading simRef.current in useState init.
function initialSim(): RaftSim {
  return createRaftSim(SEED);
}

function maxTerm(snap: RaftSnapshot): number {
  return Math.max(...snap.nodes.map((n) => n.currentTerm), 0);
}

function splitBrainAnnotation(snap: RaftSnapshot): string | null {
  const leaders = snap.nodes.filter((n) => n.alive && n.role === "leader");
  if (leaders.length < 2) return null;
  const [a, b] = leaders;
  const aMinority = a.currentTerm < b.currentTerm;
  const minority = aMinority ? a : b;
  const majority = aMinority ? b : a;
  return `two leaders visible — n${minority.id} (term ${minority.currentTerm}, minority, cannot commit) vs n${majority.id} (term ${majority.currentTerm})`;
}

function simCaption(snap: RaftSnapshot): string {
  const ann = splitBrainAnnotation(snap);
  if (ann) return ann;
  const leader = snap.nodes.find((n) => n.alive && n.role === "leader");
  if (leader) {
    return `n${leader.id} is leader — term ${leader.currentTerm} · elections ${snap.electionCount}`;
  }
  const candidates = snap.nodes.filter((n) => n.alive && n.role === "candidate");
  if (candidates.length > 0) {
    return `election in progress — ${candidates.map((c) => `n${c.id} (term ${c.currentTerm})`).join(", ")} · elections ${snap.electionCount}`;
  }
  return `no leader — elections ${snap.electionCount}`;
}

const LEGEND_ITEMS = [
  { color: "var(--color-entity)", glyph: "L", label: "leader" },
  { color: "var(--color-pending)", glyph: "C", label: "candidate" },
  { color: "var(--color-ink)", glyph: "F", label: "follower" },
  { color: "var(--color-dead)", glyph: "✕", label: "dead" },
  { color: "var(--color-dead)", glyph: "╌", label: "cut link" },
  { color: "var(--color-pending)", glyph: "◔", label: "election timer" },
  { color: "var(--color-pending)", glyph: "●", label: "RequestVote" },
  { color: "var(--color-ok)", glyph: "●", label: "vote granted (reply)" },
  { color: "var(--color-entity)", glyph: "●", label: "AppendEntries / reply" },
];

export default function RaftViz() {
  const simRef = useRef<RaftSim>(initialSim());
  const [snap, setSnap] = useState<RaftSnapshot>(() => createRaftSim(SEED).snapshot());
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSnap(simRef.current.snapshot());
  }, []);

  const takeSnap = useCallback(() => {
    setSnap(simRef.current.snapshot());
  }, []);

  const stepSim = useCallback((dtMs: number) => {
    simRef.current.step(dtMs);
  }, []);

  useSimLoop({
    step: stepSim,
    onFrame: takeSnap,
    speed,
    paused,
    reducedMotion,
    rootRef,
  });

  const handleNodeClick = useCallback(
    (id: number) => {
      const node = simRef.current.snapshot().nodes[id];
      if (node.alive) {
        simRef.current.killNode(id);
      } else {
        simRef.current.restartNode(id);
      }
      takeSnap();
    },
    [takeSnap],
  );

  const handleLinkClick = useCallback(
    (a: number, b: number) => {
      const link = simRef.current.snapshot().links.find((l) => l.a === a && l.b === b);
      if (link?.up) {
        simRef.current.cutLink(a, b);
      } else {
        simRef.current.healLink(a, b);
      }
      takeSnap();
    },
    [takeSnap],
  );

  const handleIsolateLeader = useCallback(() => {
    const currentSnap = simRef.current.snapshot();
    const leader = currentSnap.nodes.find((n) => n.alive && n.role === "leader");
    if (!leader) return;
    for (const link of currentSnap.links) {
      if (link.a === leader.id || link.b === leader.id) {
        simRef.current.cutLink(link.a, link.b);
      }
    }
    takeSnap();
  }, [takeSnap]);

  const handleSplit = useCallback(() => {
    simRef.current.partition([
      [0, 1],
      [2, 3, 4],
    ]);
    takeSnap();
  }, [takeSnap]);

  const handleHealAll = useCallback(() => {
    simRef.current.healAll();
    takeSnap();
  }, [takeSnap]);

  const handleClientWrite = useCallback(() => {
    simRef.current.clientWrite();
    takeSnap();
  }, [takeSnap]);

  const handleTogglePause = useCallback(() => {
    setPaused((p) => !p);
  }, []);

  const handleStep = useCallback(() => {
    simRef.current.step(100);
    takeSnap();
  }, [takeSnap]);

  const handleReset = useCallback(() => {
    simRef.current.reset();
    setPaused(false);
    takeSnap();
  }, [takeSnap]);

  const handleSpeedChange = useCallback((s: number) => {
    setSpeed(s as 0.5 | 1 | 2);
  }, []);

  const caption = simCaption(snap);
  const annotation = splitBrainAnnotation(snap);
  const recentLog = snap.eventLog.slice(-8);
  const term = maxTerm(snap);

  return (
    <div ref={rootRef} style={{ fontFamily: "var(--font-mono)" }}>
      <div aria-live="polite" className="sr-only">
        {caption}
      </div>

      <ClusterGraph snap={snap} onNodeClick={handleNodeClick} onLinkClick={handleLinkClick} />

      {annotation && (
        <div
          style={{
            marginTop: 6,
            padding: "6px 10px",
            border: "1px solid var(--color-pending)",
            color: "var(--color-pending)",
            fontSize: 11,
            borderRadius: 3,
            letterSpacing: "0.01em",
          }}
        >
          {annotation}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "6px 16px",
          marginTop: 12,
          padding: "8px 4px",
          borderTop: "1px solid var(--color-rule)",
          fontSize: 11,
        }}
      >
        <Stat label="elections" value={snap.electionCount} />
        <Stat label="max term" value={term} />
        <Stat
          label="leaders"
          value={snap.nodes.filter((n) => n.alive && n.role === "leader").length}
          danger={snap.nodes.filter((n) => n.alive && n.role === "leader").length > 1}
        />
        <Stat label="messages in flight" value={snap.messages.length} />
        <Stat label="cut links" value={snap.links.filter((l) => !l.up).length} />
      </div>

      <div style={{ marginTop: 6 }}>
        <Legend items={LEGEND_ITEMS} />
      </div>

      <NodePanel
        nodes={snap.nodes}
        onKill={(id) => {
          simRef.current.killNode(id);
          takeSnap();
        }}
        onRestart={(id) => {
          simRef.current.restartNode(id);
          takeSnap();
        }}
      />

      <div style={{ marginTop: 8 }}>
        <EventLog lines={recentLog} />
      </div>

      <RaftControls
        snap={snap}
        paused={paused}
        speed={speed}
        reducedMotion={reducedMotion}
        onIsolateLeader={handleIsolateLeader}
        onSplit={handleSplit}
        onHealAll={handleHealAll}
        onClientWrite={handleClientWrite}
        onTogglePause={handleTogglePause}
        onStep={handleStep}
        onReset={handleReset}
        onSpeedChange={handleSpeedChange}
      />

      {reducedMotion && (
        <p
          style={{
            fontSize: 10,
            color: "var(--color-muted)",
            marginTop: 4,
            fontStyle: "italic",
          }}
        >
          Stepped mode active (prefers-reduced-motion). Use Step to advance.
        </p>
      )}
    </div>
  );
}
