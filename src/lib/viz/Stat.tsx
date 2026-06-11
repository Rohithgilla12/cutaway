interface StatProps {
  label: string;
  value: string | number;
  danger?: boolean;
}

export function Stat({ label, value, danger }: StatProps) {
  return (
    <div>
      <span style={{ color: "var(--color-muted)", fontSize: 10 }}>{label} </span>
      <span
        style={{
          color: danger ? "var(--color-danger)" : "var(--color-ink)",
          fontWeight: 600,
          fontSize: 11,
        }}
      >
        {value}
      </span>
    </div>
  );
}
