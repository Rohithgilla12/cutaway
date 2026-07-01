import { useMemo, useRef, useState } from "react";
import { createBloom, memberKey, missKey, missKeys } from "../sim/bloomSim";

const MAX_KEYS = 64;
const PROBE_SET = missKeys(300);

export default function BloomFilterViz() {
  const insertedRef = useRef<string[]>([]);
  const [bitsPerKey, setBitsPerKey] = useState(8);
  const [k, setK] = useState(3);
  const [queryKey, setQueryKey] = useState<string | null>(null);
  const [, force] = useState(0);

  const n = insertedRef.current.length;
  const m = Math.max(16, Math.round(Math.max(n, 1) * bitsPerKey));

  const filter = useMemo(() => {
    const f = createBloom(m, k);
    for (const key of insertedRef.current) f.insert(key);
    return f;
  }, [m, k, n]);

  const bits = filter.bits();
  const fill = filter.setBitCount() / m;
  const measured = filter.measuredFpr(PROBE_SET);
  const theo = filter.theoreticalFpr();
  const optimalK = filter.optimalK();
  const probe = queryKey ? filter.probeBits(queryKey) : [];
  const probeSet = new Set(probe);
  const verdict = queryKey ? filter.query(queryKey) : null;
  const isMember = queryKey ? insertedRef.current.includes(queryKey) : false;
  const falsePositive = verdict === "MAYBE" && !isMember;

  const insertNext = () => {
    if (insertedRef.current.length >= MAX_KEYS) return;
    insertedRef.current.push(memberKey(insertedRef.current.length));
    setQueryKey(null);
    force((x) => x + 1);
  };
  const reset = () => {
    insertedRef.current = [];
    setQueryKey(null);
    force((x) => x + 1);
  };

  const cols = 32;
  const cell = 14;
  const rows = Math.ceil(m / cols);

  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
      <svg viewBox={`0 0 ${cols * cell} ${rows * cell}`} width="100%" role="img" aria-label="bloom filter bit array">
        {bits.map((on, i) => {
          const x = (i % cols) * cell;
          const y = Math.floor(i / cols) * cell;
          const probed = probeSet.has(i);
          let fillColor = on ? "var(--color-entity)" : "var(--color-raised)";
          if (probed) fillColor = on ? "var(--color-ok)" : "var(--color-danger)";
          return (
            <rect key={i} x={x + 1} y={y + 1} width={cell - 2} height={cell - 2} rx={2}
              fill={fillColor} stroke="var(--color-rule)" strokeWidth={0.5} />
          );
        })}
      </svg>

      <div aria-live="polite" style={{ marginTop: 8, color: "var(--color-muted)" }}>
        {verdict && queryKey && (
          <span style={{ color: verdict === "NO" ? "var(--color-muted)" : falsePositive ? "var(--color-danger)" : "var(--color-ok)" }}>
            query {queryKey} → {verdict}
            {verdict === "NO" && " (definitely absent)"}
            {verdict === "MAYBE" && !falsePositive && " (present)"}
            {falsePositive && " — FALSE POSITIVE"}
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 8 }}>
        <span>n = {n}</span>
        <span>m = {m} bits</span>
        <span>fill = {(fill * 100).toFixed(0)}%</span>
        <span>measured FPR = {(measured * 100).toFixed(1)}%</span>
        <span>theoretical FPR = {(theo * 100).toFixed(1)}%</span>
        <span style={{ color: k === optimalK ? "var(--color-ok)" : "var(--color-pending)" }}>optimal k = {optimalK}</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12, alignItems: "center" }}>
        <button onClick={insertNext} style={btn(true)}>Insert key</button>
        <button onClick={() => { setQueryKey(memberKey(0)); force((x) => x + 1); }} style={btn(false)} disabled={n === 0}>Query a present key</button>
        <button onClick={() => { setQueryKey(missKey(7)); force((x) => x + 1); }} style={btn(false)}>Query an absent key</button>
        <button onClick={reset} style={btn(false)}>Reset</button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, marginTop: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          bits/key = {bitsPerKey}
          <input type="range" min={2} max={20} value={bitsPerKey} onChange={(e) => setBitsPerKey(+e.target.value)} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          k = {k}
          <input type="range" min={1} max={12} value={k} onChange={(e) => setK(+e.target.value)} />
        </label>
      </div>
    </div>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return {
    minHeight: 44,
    minWidth: 44,
    padding: "8px 14px",
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    cursor: "pointer",
    border: "1px solid var(--color-rule)",
    borderRadius: 3,
    background: primary ? "var(--color-entity)" : "var(--color-raised)",
    color: primary ? "var(--color-paper)" : "var(--color-ink)",
  };
}
