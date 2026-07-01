import { useMemo, useRef, useState } from "react";
import { createLsmRead, type ReadResult } from "../sim/lsmReadSim";

const RUNS = 6;

export default function ReadAmpViz() {
  const [bitsPerKey, setBitsPerKey] = useState(10);
  const lsm = useMemo(() => createLsmRead({ runs: RUNS, keysPerRun: 60, bitsPerKey }), [bitsPerKey]);
  const [result, setResult] = useState<ReadResult | null>(null);
  const missCounter = useRef(0);

  const lookupMiss = () => setResult(lsm.lookup(`miss:${missCounter.current++}`));
  const lookupHit = () => setResult(lsm.lookup(lsm.runKey(RUNS - 1, 0)));

  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {Array.from({ length: RUNS }, (_, r) => {
          const probe = result?.probes.find((p) => p.runId === r);
          let bg = "var(--color-raised)";
          let note = "";
          if (probe) {
            if (probe.verdict === "NO") { bg = "var(--color-raised)"; note = "filter: NO → skip"; }
            else if (probe.hit) { bg = "var(--color-ok)"; note = "filter: MAYBE → probe → HIT"; }
            else if (probe.falsePositive) { bg = "var(--color-danger)"; note = "filter: MAYBE → probe → miss (false positive)"; }
            else { bg = "var(--color-pending)"; note = "filter: MAYBE → probe"; }
          }
          return (
            <div key={r} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", background: bg, border: "1px solid var(--color-rule)", borderRadius: 3 }}>
              <span style={{ width: 64 }}>{probe?.level ?? `run ${r}`}</span>
              <span style={{ color: "var(--color-muted)", fontSize: 11 }}>{note}</span>
            </div>
          );
        })}
      </div>

      <div aria-live="polite" style={{ marginTop: 8 }}>
        {result && (
          <span>
            read {result.key} → {result.found ? "found" : "not found"} · read-amp ={" "}
            <strong>{result.runsProbed}</strong> / {RUNS} runs probed
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <button onClick={lookupMiss} style={readBtn(true)}>Look up a missing key</button>
        <button onClick={lookupHit} style={readBtn(false)}>Look up a present key</button>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12 }}>
        bits/key = {bitsPerKey} (drag toward 2 to starve the filters)
        <input type="range" min={2} max={20} value={bitsPerKey} onChange={(e) => setBitsPerKey(+e.target.value)} />
      </label>
    </div>
  );
}

function readBtn(primary: boolean): React.CSSProperties {
  return {
    minHeight: 44, padding: "8px 14px", fontFamily: "var(--font-mono)", fontSize: 12, cursor: "pointer",
    border: "1px solid var(--color-rule)", borderRadius: 3,
    background: primary ? "var(--color-entity)" : "var(--color-raised)",
    color: primary ? "var(--color-paper)" : "var(--color-ink)",
  };
}
