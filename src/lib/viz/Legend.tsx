interface LegendItem {
  color: string;
  glyph: string;
  label: string;
}

interface LegendProps {
  items: LegendItem[];
}

export function Legend({ items }: LegendProps) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "4px 16px",
        fontSize: 10,
      }}
    >
      {items.map(({ color, glyph, label }) => (
        <span key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color, fontWeight: 700 }}>{glyph}</span>
          <span style={{ color: "var(--color-muted)" }}>{label}</span>
        </span>
      ))}
    </div>
  );
}
