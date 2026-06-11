# Visualization patterns

Conventions for Cutaway interactive components. Read before building the first component in a session. These exist so every explainer feels like one site and every component survives reader abuse.

## Architecture

```
sim/walSim.ts          pure TS state machine + transition fns + seeded RNG
sim/walSim.test.ts     invariant tests
components/WalViz.tsx  React island: owns a sim instance, rAF loop, renders SVG
```

The render layer NEVER mutates sim state directly — it dispatches sim events (`crash()`, `hit()`, `partition(a,b)`) and renders whatever the sim returns. UI state (hover, selected tab) lives in React; system state lives in the sim. If you find system state in a `useState`, move it.

### rAF loop pattern

```tsx
const simRef = useRef(createSim(seed));
const [frame, setFrame] = useState(() => simRef.current.snapshot());

useEffect(() => {
  if (reducedMotion || paused) return;
  let raf: number, last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(now - last, 100); // clamp: tab-background protection
    last = now;
    simRef.current.step(dt);
    setFrame(simRef.current.snapshot());
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}, [paused, reducedMotion]);
```

The `dt` clamp matters: when a backgrounded tab resumes, rAF delivers a huge delta; an unclamped sim fast-forwards minutes of activity in one frame and appears corrupted.

## SVG vs canvas

Default: SVG. Declarative, debuggable, styleable, accessible. Switch to canvas only when animating hundreds+ of independent entities (e.g., request-particle storms) where SVG DOM churn janks.

SVG sizing: fixed `viewBox`, width 100%, design at 700×400-ish, test at 360px width. Text inside SVG ≥ 12px *after* scaling at 360px — if labels become unreadable, move them to HTML below the SVG.

## Standard control bar

Consistent across all components, rendered as HTML (not SVG), below the visualization:

- **Primary action button(s)**: the verbs of this component (`Hit`, `Crash`, `Partition`, `Commit`). These are the stars — visually primary.
- **Pause/Play** toggle, **Reset** button. Always present.
- Optional **speed** control (0.5× / 1× / 2×) for time-dense sims.
- Parameter sliders only when varying the parameter teaches something; label with the real parameter name and live value (`refillInterval = 4s`).

Hit targets ≥ 44×44px. No hover-only information; anything shown on hover must also be reachable by tap (tap-to-pin) or always visible.

## Reduced motion = stepped mode

When `prefers-reduced-motion` (or the user toggles it): the component switches from continuous animation to discrete states navigated with **Prev / Next** buttons, each state accompanied by a one-line caption ("fsync acknowledged; LSN 42 now durable"). Design these captions deliberately — stepped mode is the component's storyboard, and writing it first often improves the animated version.

```ts
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
```

## Motion & color conventions

- Durations: micro-feedback 150–250ms; entity movement 300–600ms; never > 1s for a single transition. Ease-out for entries, ease-in for exits.
- Continuous flows (requests, tokens, log records) move at constant visual speed so readers build rate intuition.
- Color semantics, consistent site-wide (define once as CSS variables, respecting `prefers-color-scheme`):
  - green = allowed / committed / durable / healthy
  - red = blocked / failed / lost
  - amber = pending / in-flight / unsynced
  - blue = neutral entity / reader-controlled element
  - gray = dead / partitioned / stale
- Never encode meaning in color alone: pair with shape, icon, label, or pattern (✓/✕ glyphs on dots, dashed strokes for partitioned links).
- A persistent mini-legend on any component with ≥ 3 entity states.

## State display

- Show the system's bookkeeping, not just its motion: counters, LSN pointers, term numbers, pool occupancy meters as live text/badges. Senior readers want to watch the numbers.
- When the reader triggers a failure, freeze or slow the moment and annotate it ("crash here — records after LSN 17 were never fsynced") rather than letting it flash past. A failure that animates by in 300ms teaches nothing.
- After recovery/restart sequences, leave a residual diff visible (e.g., greyed-out lost records) so the reader can study the outcome.

## Resilience checklist (every component)

- Button spam: all sim events are valid in all states (or no-ops); no event ever throws or corrupts.
- Pause mid-anything: snapshot renders coherently from any sim state.
- Reset: returns to the exact initial seeded state (deterministic — same seed, same demo).
- Resize: viewBox scales; HTML controls reflow; nothing overlaps at 360px.
- Background/foreground: dt clamp prevents fast-forward weirdness.
- Keyboard: controls are real `<button>`s, focus order follows visual order, state changes announced via a visually-hidden `aria-live="polite"` region with the stepped-mode captions.

## Performance

- One rAF loop per component; pause it when the island scrolls out of view (IntersectionObserver) and when `document.hidden`.
- SVG: animate with `transform` attributes, not layout-triggering properties. Memoize static substructure.
- Budget: smooth on a mid-range Android phone. If a component needs a worker or canvas to hit this, it's probably over-scoped — simplify the visual before optimizing the code.
