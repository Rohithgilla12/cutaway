import { useCallback, useState } from "react";
import { createQuorumSim } from "../sim/quorumSim";
import type { QuorumSim, QuorumSnapshot } from "../sim/quorumSim";
import { ReplicaRow } from "./ReplicaRow";
import { QuorumControls } from "./QuorumControls";
import { EventLog } from "../../../../lib/viz";

function ResultBand({ snap }: { snap: QuorumSnapshot }) {
  const rd = snap.lastRead;
  if (!rd) return null;
  const bad = rd.mode === "failed" || !rd.fresh;
  return (
    <div
      style={{
        marginTop: 10,
        padding: "8px 10px",
        borderRadius: 3,
        border: `1px solid ${bad ? "var(--color-danger)" : "var(--color-ok)"}`,
        background: "var(--color-paper)",
        fontSize: 12,
      }}
    >
      <span style={{ fontWeight: 700, color: bad ? "var(--color-danger)" : "var(--color-ok)" }}>
        {rd.mode === "failed" ? "✕ read unavailable" : rd.fresh ? "✓ fresh read" : "✕ stale read"}
      </span>{" "}
      <span style={{ color: "var(--color-ink)" }}>{rd.reason}</span>
      {snap.lastWrite && snap.lastRead?.mode === "ok" && (
        <div style={{ fontSize: 10, color: "var(--color-muted)", marginTop: 3 }}>
          write set {`{${snap.lastWrite.homeTargets.join(", ") || "—"}}`} · read set{" "}
          {`{${snap.lastRead.responders.join(", ")}}`} · overlap {`{${snap.overlap.join(", ") || "∅"}}`}
        </div>
      )}
    </div>
  );
}

export default function QuorumViz() {
  const [sim] = useState<QuorumSim>(() => createQuorumSim());
  const [snap, setSnap] = useState<QuorumSnapshot>(() => sim.snapshot());

  const sync = useCallback(() => setSnap(sim.snapshot()), [sim]);

  const act = useCallback(
    (fn: (s: QuorumSim) => void) => {
      fn(sim);
      sync();
    },
    [sim, sync],
  );

  const verdict = snap.guaranteedOverlap
    ? "R + W > N — every read quorum intersects every write quorum, so a successful read sees the latest write"
    : "R + W ≤ N — a read quorum can miss the write quorum entirely; stale reads are possible";

  return (
    <div style={{ fontFamily: "var(--font-mono)" }}>
      <div aria-live="polite" className="sr-only">
        {snap.lastRead ? snap.lastRead.reason : verdict}
      </div>

      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: snap.guaranteedOverlap ? "var(--color-ok)" : "var(--color-danger)",
          marginBottom: 8,
        }}
      >
        {verdict}
      </div>

      <ReplicaRow
        snap={snap}
        onTogglePartition={(id) => act((s) => s.togglePartition(id))}
        onToggleStandin={(id) => act((s) => s.toggleStandinPartition(id))}
      />

      <div style={{ marginTop: 8, fontSize: 11, color: "var(--color-muted)" }}>
        latest committed: <span style={{ color: "var(--color-ink)", fontWeight: 600 }}>{snap.committedValue}</span> (version{" "}
        {snap.committedVersion}) · {snap.reachableCount}/{snap.n} replicas reachable
      </div>

      <ResultBand snap={snap} />

      <div style={{ marginTop: 8 }}>
        <EventLog lines={snap.eventLog.slice(-5)} caption="" />
      </div>

      <div style={{ marginTop: 8 }}>
        <QuorumControls
          snap={snap}
          onWrite={() => act((s) => s.write())}
          onRead={() => act((s) => s.read())}
          onSetN={(v) => act((s) => s.setN(v))}
          onSetR={(v) => act((s) => s.setR(v))}
          onSetW={(v) => act((s) => s.setW(v))}
          onToggleSloppy={() => act((s) => s.setSloppy(!snap.sloppy))}
          onToggleReadRepair={() => act((s) => s.setReadRepair(!snap.readRepair))}
          onReset={() => act((s) => s.reset())}
        />
      </div>
    </div>
  );
}
