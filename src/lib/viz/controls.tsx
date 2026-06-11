import type React from "react";

const BTN_BASE: React.CSSProperties = {
  minWidth: 44,
  minHeight: 44,
  padding: "6px 14px",
  fontFamily: "var(--font-mono)",
  fontSize: "12px",
  cursor: "pointer",
  border: "1px solid var(--color-rule)",
  borderRadius: 3,
  background: "var(--color-raised)",
  color: "var(--color-ink)",
  letterSpacing: "0.02em",
};

const BTN_PRIMARY: React.CSSProperties = {
  ...BTN_BASE,
  background: "var(--color-ink)",
  color: "var(--color-raised)",
  border: "1px solid var(--color-ink)",
};

const BTN_DANGER: React.CSSProperties = {
  ...BTN_BASE,
  background: "var(--color-danger)",
  color: "var(--color-paper)",
  border: "1px solid var(--color-danger)",
};

const BTN_DISABLED: React.CSSProperties = {
  ...BTN_BASE,
  opacity: 0.45,
  cursor: "default",
  color: "var(--color-muted)",
};

export { BTN_BASE, BTN_PRIMARY, BTN_DANGER, BTN_DISABLED };

type ButtonVariant = "default" | "primary" | "danger";

interface VizButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function VizButton({ variant = "default", disabled, style, ...rest }: VizButtonProps) {
  let base: React.CSSProperties;
  if (disabled) {
    base = BTN_DISABLED;
  } else if (variant === "primary") {
    base = BTN_PRIMARY;
  } else if (variant === "danger") {
    base = BTN_DANGER;
  } else {
    base = BTN_BASE;
  }
  return <button style={{ ...base, ...style }} disabled={disabled} {...rest} />;
}

interface VizToggleProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-pressed"> {
  pressed: boolean;
  label: string;
}

export function VizToggle({ pressed, label, disabled, style, ...rest }: VizToggleProps) {
  const toggleStyle: React.CSSProperties = {
    ...BTN_BASE,
    background: pressed ? "var(--color-ink)" : "var(--color-raised)",
    color: pressed ? "var(--color-raised)" : "var(--color-ink)",
    ...(disabled ? { opacity: 0.45, cursor: "default" } : {}),
    ...style,
  };
  return (
    <button style={toggleStyle} aria-pressed={pressed} disabled={disabled} {...rest}>
      {label}
    </button>
  );
}

interface SpeedControlProps {
  speed: number;
  onSpeedChange: (s: number) => void;
}

export function SpeedControl({ speed, onSpeedChange }: SpeedControlProps) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      {([0.5, 1, 2] as const).map((s) => (
        <button
          key={s}
          style={{
            ...BTN_BASE,
            padding: "4px 8px",
            background: speed === s ? "var(--color-ink)" : "var(--color-raised)",
            color: speed === s ? "var(--color-raised)" : "var(--color-muted)",
            fontSize: "11px",
          }}
          onClick={() => onSpeedChange(s)}
          aria-pressed={speed === s}
          title={`Set speed to ${s}×`}
        >
          {s}×
        </button>
      ))}
    </div>
  );
}

interface PlayPauseOrStepProps {
  paused: boolean;
  reducedMotion: boolean;
  onTogglePause: () => void;
  onStep: () => void;
}

export function PlayPauseOrStep({ paused, reducedMotion, onTogglePause, onStep }: PlayPauseOrStepProps) {
  if (reducedMotion) {
    return (
      <button style={BTN_BASE} onClick={onStep} title="Advance simulation by 100ms" aria-label="Step simulation forward 100ms">
        Step
      </button>
    );
  }
  return (
    <button
      style={BTN_BASE}
      onClick={onTogglePause}
      title={paused ? "Resume animation" : "Pause animation"}
      aria-pressed={paused}
    >
      {paused ? "▶ Play" : "⏸ Pause"}
    </button>
  );
}
