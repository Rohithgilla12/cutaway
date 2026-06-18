import { useCallback, useEffect, useRef, useState } from "react";
import { createBtreeSim } from "../sim/btreeSim";
import type { BtreeSim, BtreeSnapshot, InsertMode } from "../sim/btreeSim";
import { BTreeDiagram } from "./BTreeDiagram";
import { BtreeControls } from "./BtreeControls";
import { useReducedMotion, useSimLoop, Legend, Stat, EventLog } from "../../../../lib/viz";

const SEED = 0x5eed_b7ee;

const LEGEND_ITEMS = [
  { color: "var(--color-ok)", glyph: "▰", label: "leaf ≥ 80% full" },
  { color: "var(--color-pending)", glyph: "▰", label: "55–80% full" },
  { color: "var(--color-danger)", glyph: "▰", label: "< 55% full" },
  { color: "var(--color-entity)", glyph: "▢", label: "just split" },
];

function caption(snap: BtreeSnapshot): string {
  return `${snap.mode} keys: height ${snap.height}, ${snap.leafCount} leaves, ${snap.fillPct.toFixed(0)}% full, ${snap.leafSplits} leaf splits (${snap.rightmostSplits} rightmost, ${snap.interiorSplits} interior)`;
}

export default function BtreeViz() {
  const simRef = useRef<BtreeSim>(createBtreeSim(SEED));
  const [snap, setSnap] = useState<BtreeSnapshot>(() => createBtreeSim(SEED).snapshot());
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);
  const reducedMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSnap(simRef.current.snapshot());
  }, []);

  const takeSnap = useCallback(() => setSnap(simRef.current.snapshot()), []);
  const stepSim = useCallback((dtMs: number) => simRef.current.step(dtMs), []);
  useSimLoop({ step: stepSim, onFrame: takeSnap, speed, paused, reducedMotion, rootRef });

  const act = useCallback(
    (fn: (s: BtreeSim) => void) => {
      fn(simRef.current);
      takeSnap();
    },
    [takeSnap],
  );

  return (
    <div ref={rootRef} style={{ fontFamily: "var(--font-mono)" }}>
      <div aria-live="polite" className="sr-only">
        {caption(snap)}
      </div>

      <BTreeDiagram root={snap.root} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(115px, 1fr))",
          gap: "6px 14px",
          marginTop: 10,
          padding: "8px 4px",
          borderTop: "1px solid var(--color-rule)",
          fontSize: 11,
        }}
      >
        <Stat label="height" value={snap.height} />
        <Stat label="leaves" value={snap.leafCount} />
        <Stat label="keys" value={`${snap.totalKeys}/${snap.capacityKeys}`} />
        <Stat label="space used" value={`${snap.fillPct.toFixed(0)}%`} danger={snap.fillPct < 55} />
        <Stat label="leaf splits" value={snap.leafSplits} />
        <Stat label="↳ rightmost" value={snap.rightmostSplits} />
        <Stat label="↳ interior" value={snap.interiorSplits} danger={snap.interiorSplits > 0} />
        <Stat label="splits / insert" value={snap.splitsPerInsert.toFixed(2)} />
      </div>

      <div style={{ marginTop: 8 }}>
        <Legend items={LEGEND_ITEMS} />
      </div>

      <div style={{ marginTop: 8 }}>
        <EventLog lines={snap.eventLog.slice(-5)} caption="" />
      </div>

      <div style={{ marginTop: 8 }}>
        <BtreeControls
          snap={snap}
          paused={paused}
          speed={speed}
          reducedMotion={reducedMotion}
          onInsert={() => act((s) => s.insert())}
          onSetMode={(m: InsertMode) => act((s) => s.setMode(m))}
          onSetFillfactor={(ff) => act((s) => s.setFillfactor(ff))}
          onToggleWorkload={() => act((s) => s.setWorkload(!snap.workload))}
          onTogglePause={() => setPaused((p) => !p)}
          onStep={() => act((s) => s.insert())}
          onReset={() => act((s) => s.reset())}
          onSpeedChange={(s) => setSpeed(s as 0.5 | 1 | 2)}
        />
      </div>

      {reducedMotion && (
        <p style={{ fontSize: 10, color: "var(--color-muted)", marginTop: 4, fontStyle: "italic" }}>
          Stepped mode active (prefers-reduced-motion). Use Insert key / Step to advance one key at a time.
        </p>
      )}
    </div>
  );
}
