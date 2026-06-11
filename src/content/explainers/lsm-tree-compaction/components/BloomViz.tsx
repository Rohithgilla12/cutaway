import { useCallback, useRef, useState } from "react";
import { createBloom, memberKey, nonMemberKey, UNIVERSE_SIZE } from "../sim/bloom";
import { VizButton, Stat } from "../../../../lib/viz";

interface QueryResult {
  key: string;
  positions: [number, number, number];
  verdict: "member-hit" | "false-positive" | "absent";
  firstClearBit: number | null;
}

interface BloomState {
  bits: readonly boolean[];
  keyCount: number;
  lastKey: string | null;
  lastPositions: [number, number, number] | null;
  lastResult: QueryResult | null;
  memberIndex: number;
  nonMemberIndex: number;
  queriesTotal: number;
  tablesSkipped: number;
  falsePositives: number;
}

const CELL_SIZE = 10;
const CELLS_PER_ROW = 16;
const GRID_GAP = 2;

function verdictText(result: QueryResult): string {
  if (result.verdict === "absent") {
    const pos = result.firstClearBit !== null ? ` (bit ${result.firstClearBit} clear)` : "";
    return `“${result.key}”—bit clear${pos}—definitely absent—table skipped`;
  }
  if (result.verdict === "false-positive") {
    return `“${result.key}”—all 3 bits set—FALSE POSITIVE—table read for nothing`;
  }
  return `“${result.key}”—all 3 bits set—maybe present (confirmed member)`;
}

function BitGrid({ bits, probed }: { bits: readonly boolean[]; probed: readonly number[] }) {
  const probedSet = new Set(probed);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${CELLS_PER_ROW}, ${CELL_SIZE}px)`,
        gap: GRID_GAP,
      }}
      aria-hidden="true"
    >
      {bits.map((set, i) => {
        const isProbed = probedSet.has(i);
        let bg: string;
        if (isProbed && !set) {
          bg = "var(--color-danger)";
        } else if (set) {
          bg = "var(--color-entity)";
        } else {
          bg = "var(--color-rule)";
        }
        return (
          <div
            key={i}
            title={`bit ${i}: ${set ? "1" : "0"}${isProbed ? " (probed)" : ""}`}
            style={{
              width: CELL_SIZE,
              height: CELL_SIZE,
              background: bg,
              border: isProbed ? "1px solid var(--color-ink)" : "1px solid transparent",
              borderRadius: 1,
              transition: "background 150ms ease-out",
            }}
          />
        );
      })}
    </div>
  );
}

export default function BloomViz() {
  const bloomRef = useRef(createBloom());

  // The initial bits are all false — reading bloomRef.current during render is
  // forbidden by react-hooks/refs, and the initial filter is always empty.
  const [state, setState] = useState<BloomState>(() => ({
    bits: new Array<boolean>(64).fill(false),
    keyCount: 0,
    lastKey: null,
    lastPositions: null,
    lastResult: null,
    memberIndex: 0,
    nonMemberIndex: 0,
    queriesTotal: 0,
    tablesSkipped: 0,
    falsePositives: 0,
  }));

  const handleAddKey = useCallback(() => {
    setState((prev) => {
      const idx = prev.memberIndex % UNIVERSE_SIZE;
      const key = memberKey(idx);
      bloomRef.current.add(key);
      return {
        ...prev,
        bits: bloomRef.current.bits(),
        keyCount: bloomRef.current.keyCount(),
        lastKey: key,
        lastPositions: bloomRef.current.probePositions(key),
        lastResult: null,
        memberIndex: idx + 1,
      };
    });
  }, []);

  const handleQueryMember = useCallback(() => {
    setState((prev) => {
      if (prev.keyCount === 0) return prev;
      const idx = (prev.memberIndex - 1 + UNIVERSE_SIZE) % UNIVERSE_SIZE;
      const key = memberKey(idx);
      const positions = bloomRef.current.probePositions(key);
      const bits = bloomRef.current.bits();
      const hit = bloomRef.current.mightContain(key);
      const firstClearBit = hit ? null : (positions.find((p) => !bits[p]) ?? null);
      const result: QueryResult = {
        key,
        positions,
        verdict: hit ? "member-hit" : "absent",
        firstClearBit,
      };
      return {
        ...prev,
        bits,
        lastKey: key,
        lastPositions: positions,
        lastResult: result,
        queriesTotal: prev.queriesTotal + 1,
        tablesSkipped: result.verdict === "absent" ? prev.tablesSkipped + 1 : prev.tablesSkipped,
      };
    });
  }, []);

  const handleQueryNonMember = useCallback(() => {
    setState((prev) => {
      const idx = prev.nonMemberIndex % UNIVERSE_SIZE;
      const key = nonMemberKey(idx);
      const positions = bloomRef.current.probePositions(key);
      const bits = bloomRef.current.bits();
      const hit = bloomRef.current.mightContain(key);
      const firstClearBit = hit ? null : (positions.find((p) => !bits[p]) ?? null);
      const isFp = hit;
      const result: QueryResult = {
        key,
        positions,
        verdict: isFp ? "false-positive" : "absent",
        firstClearBit,
      };
      return {
        ...prev,
        bits,
        lastKey: key,
        lastPositions: positions,
        lastResult: result,
        nonMemberIndex: idx + 1,
        queriesTotal: prev.queriesTotal + 1,
        tablesSkipped: isFp ? prev.tablesSkipped : prev.tablesSkipped + 1,
        falsePositives: isFp ? prev.falsePositives + 1 : prev.falsePositives,
      };
    });
  }, []);

  const handleReset = useCallback(() => {
    bloomRef.current.reset();
    setState({
      bits: bloomRef.current.bits(),
      keyCount: 0,
      lastKey: null,
      lastPositions: null,
      lastResult: null,
      memberIndex: 0,
      nonMemberIndex: 0,
      queriesTotal: 0,
      tablesSkipped: 0,
      falsePositives: 0,
    });
  }, []);

  const probed: readonly number[] = state.lastPositions ?? [];

  const verdictStyle: React.CSSProperties = (() => {
    if (!state.lastResult) return { color: "var(--color-muted)" };
    if (state.lastResult.verdict === "false-positive") return { color: "var(--color-danger)", fontWeight: 600 };
    if (state.lastResult.verdict === "absent") return { color: "var(--color-ok)" };
    return { color: "var(--color-entity)" };
  })();

  const ariaVerdict = state.lastResult
    ? verdictText(state.lastResult)
    : state.lastKey
      ? `added key “${state.lastKey}” — bits ${(state.lastPositions ?? []).join(", ")} set`
      : "";

  return (
    <div style={{ fontFamily: "var(--font-mono)" }}>
      <div aria-live="polite" className="sr-only">
        {ariaVerdict}
      </div>

      <div style={{ marginBottom: 8, fontSize: 10, color: "var(--color-muted)", letterSpacing: "0.05em" }}>
        BIT ARRAY &mdash; 64 BITS &mdash; k=3 HASH FUNCTIONS
      </div>

      <BitGrid bits={state.bits} probed={probed} />

      <div
        style={{
          marginTop: 8,
          minHeight: 36,
          padding: "6px 8px",
          background: "var(--color-raised)",
          border: "1px solid var(--color-rule)",
          borderRadius: 3,
          fontSize: 11,
          lineHeight: 1.5,
          ...verdictStyle,
        }}
      >
        {state.lastResult ? (
          verdictText(state.lastResult)
        ) : state.lastKey && !state.lastResult ? (
          <span style={{ color: "var(--color-muted)" }}>
            added &ldquo;{state.lastKey}&rdquo; &mdash; set bits {(state.lastPositions ?? []).join(", ")}
          </span>
        ) : (
          <span style={{ color: "var(--color-muted)" }}>add keys, then query members and non-members</span>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
          gap: "6px 16px",
          marginTop: 10,
          padding: "8px 4px",
          borderTop: "1px solid var(--color-rule)",
          fontSize: 11,
        }}
      >
        <Stat label="keys added" value={state.keyCount} />
        <Stat label="queries" value={state.queriesTotal} />
        <Stat label="tables skipped" value={state.tablesSkipped} />
        <Stat label="false positives" value={state.falsePositives} danger={state.falsePositives > 0} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        <VizButton variant="primary" onClick={handleAddKey}>
          Add random key
        </VizButton>
        <VizButton onClick={handleQueryMember} disabled={state.keyCount === 0}>
          Query member
        </VizButton>
        <VizButton onClick={handleQueryNonMember}>Query non-member</VizButton>
        <VizButton onClick={handleReset}>Reset</VizButton>
      </div>

      <div
        style={{
          marginTop: 8,
          fontSize: 10,
          color: "var(--color-muted)",
          display: "flex",
          gap: "0 16px",
          flexWrap: "wrap",
        }}
      >
        <span>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              background: "var(--color-entity)",
              borderRadius: 1,
              marginRight: 4,
              verticalAlign: "middle",
            }}
          />
          set bit
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              background: "var(--color-rule)",
              borderRadius: 1,
              marginRight: 4,
              verticalAlign: "middle",
            }}
          />
          clear bit
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              background: "var(--color-danger)",
              border: "1px solid var(--color-ink)",
              borderRadius: 1,
              marginRight: 4,
              verticalAlign: "middle",
            }}
          />
          probed clear (absent)
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              background: "var(--color-entity)",
              border: "1px solid var(--color-ink)",
              borderRadius: 1,
              marginRight: 4,
              verticalAlign: "middle",
            }}
          />
          probed set
        </span>
      </div>
    </div>
  );
}
