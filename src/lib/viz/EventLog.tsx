interface EventLogProps {
  lines: string[];
  caption?: string;
}

export function EventLog({ lines, caption }: EventLogProps) {
  if (lines.length === 0) return null;
  return (
    <>
      {caption !== undefined && (
        <div aria-live="polite" className="sr-only">
          {caption}
        </div>
      )}
      <div
        style={{
          padding: "6px 8px",
          borderTop: "1px solid var(--color-rule)",
          fontSize: 10,
          color: "var(--color-muted)",
          lineHeight: 1.7,
        }}
      >
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </>
  );
}
