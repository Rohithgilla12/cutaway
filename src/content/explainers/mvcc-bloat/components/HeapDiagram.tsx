import type { MvccSnapshot, TupleView } from "../sim/mvccSim";
import { DISK_PAGE_CAP } from "../sim/mvccSim";

const FATE_COLOR: Record<TupleView["fate"], string> = {
  live: "var(--color-ok)",
  "dead-pinned": "var(--color-pending)",
  "dead-removable": "var(--color-dead)",
};

const FATE_GLYPH: Record<TupleView["fate"], string> = {
  live: "●",
  "dead-pinned": "◆",
  "dead-removable": "✕",
};

function TupleChip({ tuple }: { tuple: TupleView }) {
  const color = FATE_COLOR[tuple.fate];
  return (
    <div
      style={{
        border: `1px solid ${color}`,
        outline: tuple.visibleToSnapshot ? "2px solid var(--color-entity)" : "none",
        outlineOffset: 1,
        borderRadius: 2,
        padding: "1px 3px",
        fontSize: 10,
        lineHeight: 1.35,
        minWidth: 0,
        opacity: tuple.fate === "dead-removable" ? 0.6 : 1,
      }}
      title={`row ${tuple.rowId} v${tuple.version} — xmin ${tuple.xmin}, xmax ${tuple.xmax === 0 ? "none (current)" : tuple.xmax} — ${tuple.fate}${tuple.visibleToSnapshot ? " — visible to held snapshot" : ""}`}
    >
      <div style={{ color, fontWeight: 600, whiteSpace: "nowrap" }}>
        {FATE_GLYPH[tuple.fate]} r{tuple.rowId} v{tuple.version}
      </div>
      <div style={{ color: "var(--color-muted)", whiteSpace: "nowrap" }}>
        {tuple.xmin}→{tuple.xmax === 0 ? "·" : tuple.xmax}
      </div>
    </div>
  );
}

function FreeSlot() {
  return (
    <div
      style={{
        border: "1px dashed var(--color-rule)",
        borderRadius: 2,
        padding: "1px 3px",
        fontSize: 10,
        lineHeight: 1.35,
        color: "var(--color-rule)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      title="free slot (reusable space)"
    >
      <span style={{ color: "var(--color-muted)", opacity: 0.5 }}>·&nbsp;free&nbsp;·</span>
    </div>
  );
}

export function HeapDiagram({ snap }: { snap: MvccSnapshot }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))",
        gap: 6,
      }}
    >
      {snap.pages.map((page) => (
        <div
          key={page.index}
          style={{
            border: "1px solid var(--color-rule)",
            borderRadius: 3,
            padding: 4,
            background: "var(--color-raised)",
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: "var(--color-muted)",
              letterSpacing: "0.05em",
              marginBottom: 3,
            }}
          >
            PAGE {page.index}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
            {page.slots.map((t, si) => (t === null ? <FreeSlot key={si} /> : <TupleChip key={si} tuple={t} />))}
          </div>
        </div>
      ))}
      {snap.pageCount < DISK_PAGE_CAP && (
        <div
          style={{
            border: "1px dashed var(--color-rule)",
            borderRadius: 3,
            padding: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 9,
            color: "var(--color-muted)",
            minHeight: 56,
          }}
        >
          {DISK_PAGE_CAP - snap.pageCount} page{DISK_PAGE_CAP - snap.pageCount > 1 ? "s" : ""} of disk left
        </div>
      )}
    </div>
  );
}
