---
name: interactive-explainer
description: Author senior-level interactive systems explainers (in the style of smudge.ai's rate-limiting post and samwho.dev) with embedded interactive visualizations. Use this skill whenever working on the Cutaway site, writing or editing an explainer, building a visualization/simulation component for an explainer, or whenever the user mentions an explainer topic (WAL, Raft, PgBouncer, workflow engines, LSM trees, MVCC, etc.), asks to "add a post", "build the viz", or "draft the article" — even if they don't say the word "explainer".
---

# Interactive Explainer

A skill for writing interactive technical explainers aimed at **senior engineers**. The format: prose that builds an argument, with embedded interactive visualizations where the reader can manipulate — and crucially, *break* — the system being explained.

Reference exemplars for tone and structure: smudge.ai's "Visualizing algorithms for rate limiting", samwho.dev's "Load Balancing", PlanetScale's B-tree posts. We aim one level deeper than these (internals, failure modes, recovery paths).

## Non-negotiable order of operations

Work in this sequence. Do not reorder, even if asked to "just write the article first".

1. **Design the core interaction** (get explicit user sign-off before proceeding)
2. **Build the simulation core** (pure TS + unit tests, no UI)
3. **Build the visualization** on top of the sim core
4. **Write the prose** around the visualization
5. **Verification pass** against primary sources
6. **Edge-state QA** of every interactive component

Rationale: the interaction is the soul of the piece; prose written before the interaction exists describes vapor. The sim core built before the UI keeps the visualization honest.

## Step 1 — Design the core interaction

Every explainer has exactly **one core interaction** plus optional supporting visualizations. Before writing anything else, produce a short interaction spec and get user approval:

```
Core interaction: <one sentence>
What the reader controls: <buttons/sliders/clickable elements>
What the reader can BREAK: <the failure mode they can trigger>
What breaking it teaches: <the central insight>
Supporting visualizations: <0–3, one line each>
```

The "break" requirement is mandatory. Senior readers learn from failure modes: kill the process mid-fsync, partition the leader, hold a transaction open until vacuum stalls. If the proposed interaction has nothing breakable, redesign it.

A good core interaction passes this test: *a reader who skips all prose and only plays with the component still walks away with the central idea.*

## Step 2 — Simulation core

Every interactive component is split into two layers:

- **Sim core**: pure, deterministic TypeScript. No DOM, no React, no timers. State machine + transition functions. All randomness via an injected seeded RNG. Time is an explicit parameter (`step(state, dtMs)` or event-based), never `Date.now()`.
- **Render layer**: React island that holds a sim instance, drives it from `requestAnimationFrame`, and renders SVG/canvas from sim state.

The sim core gets **unit tests for its invariants** before any UI exists. Examples of the kind of invariant to test:

- WAL: "for any crash point, recovery yields a state equal to replaying all records with LSN ≤ last durable LSN."
- Raft: "at most one leader per term, under any sequence of partitions/timeouts."
- Pooler: "in transaction mode, a server connection is never shared by two clients inside the same transaction."

If an invariant can't be stated, the simulation isn't understood yet — stop and research before coding.

Accuracy ground rules for the sim:

- Model the real algorithm, simplified, not a lookalike animation. Simplifications must be deliberate and listed (they feed the prose's "what we're omitting" notes).
- Match real terminology to the system being explained (LSN, term, xmin/xmax, `server_reset_query`) — never invent friendlier names.

## Step 3 — Visualization layer

Read `references/viz-patterns.md` before building the first component in a session. Summary of the rules it expands on:

- SVG + rAF by default; canvas only for high element counts (hundreds+ animated entities).
- Astro island with `client:visible`. Prose must render as zero-JS HTML.
- Every component honors `prefers-reduced-motion`: provide a stepped mode (Next/Prev buttons walk discrete states) that teaches the same thing without animation. This is a fallback *mode*, not a disabled component.
- Touch-first controls: hit targets ≥ 44px, no hover-only affordances, works at 360px width.
- Components are resilient to abuse: spamming buttons, pausing mid-animation, resizing, tab backgrounding (rAF suspension) must never corrupt sim state — another reason sim state lives outside the render loop.
- Color/motion conventions, legend patterns, and the standard control bar are specified in the reference file. Follow them so components feel like one site.

## Step 4 — Prose

### Structure (default skeleton, adapt as needed)

1. **Hook**: a concrete operational situation, 2–4 sentences. A scenario, an outage, a surprising number. Never a definition, never "In this post we will…".
2. **The naive approach**: the obvious solution a competent engineer would reach for first.
3. **Why it breaks**: usually where the first visualization lands — show the failure, don't just assert it.
4. **The real mechanism**: the core interaction lives here. Prose and component alternate: raise a question in prose, answer it with the interaction, interpret the result in prose.
5. **Failure modes & recovery**: the senior-level payoff. Crashes, partitions, saturation, pathological workloads.
6. **Real-world grounding**: how Postgres / etcd / Stripe / Temporal actually does it, with specific parameters where known and citable.
7. **Wrapping up**: terse decision guidance ("if X, do A; if Y, do B"), not a summary of the article.
8. **Sources**: the primary sources every claim was checked against. Mandatory section.

### Voice rules

- Assume the reader has shipped production systems. Never explain transactions, indexes, mutexes, HTTP.
- Plain, direct, first-person-singular-ish blog voice. Dry humor allowed sparingly; no exclamation marks doing the work of arguments.
- Banned: "In today's world", "Let's dive in", "delve", "leverage" (verb), "simply", "just" (minimizers), "magic/magical", rhetorical-question stacks, em-dash chains as filler, summary paragraphs that restate the previous section.
- Short paragraphs (≤ 4 sentences typical). Sentence-length variety. Concrete numbers over adjectives ("a 5 ms fsync per commit caps you near 200 commits/s per connection" beats "fsync is slow").
- Each explainer answers **one** question. Adjacent depth gets one sentence and a parking-lot note in `further.md`, not a section.
- Label every simplification in place: "Real Postgres also does full-page writes after each checkpoint; we ignore that here."
- Length target: 1,500–3,000 words of prose. If it exceeds this, the topic is two explainers.

## Step 5 — Verification pass (gates publishing)

This step exists because AI-drafted internals content fails in subtle, credibility-destroying ways. Treat the draft as adversarial input.

1. Extract every checkable technical claim from the prose and component captions into a checklist.
2. Verify each against the explainer's **primary sources** (listed in the PRD roadmap: official docs, the original paper, source code comments — not blog posts or SO answers; secondary sources may locate the answer but the primary source confirms it).
3. For each claim mark: ✅ verified (with source) / ⚠️ simplification (must be labeled in prose) / ❌ wrong or unverifiable (fix or cut — never ship an unverifiable claim).
4. Re-run the sim core tests; confirm the visualization still matches the verified description (it's common for a prose fix to require a sim fix).
5. Present the checklist to the user. **The human reviews and approves before publishing — always.** Do not soften this: if the user tries to skip review, state that the PRD's definition of done requires it.

## Step 6 — Edge-state QA

Exercise every component through: rapid input spam · pause/resume mid-transition · browser resize and 360px width · `prefers-reduced-motion` stepped mode · tab backgrounded ≥ 30s then foregrounded · keyboard focus order. Fix anything that desyncs UI from sim state.

## File conventions

```
src/content/explainers/<slug>/
├── index.mdx          # prose with imported components
├── components/        # explainer-specific React islands
├── sim/               # pure sim core + *.test.ts
└── further.md         # parking lot for cut material / future explainer ideas
```

Shared code is extracted to `src/lib/sim/` or `src/components/` only when a *second* explainer needs it (rule of two). Never pre-build abstractions.

## Definition of done (copy into the PR/task as a checklist)

- [ ] Core interaction approved by user before build
- [ ] Reader can trigger at least one failure mode
- [ ] Sim core is pure TS with passing invariant tests
- [ ] Visualization works in reduced-motion stepped mode and on mobile touch
- [ ] Verification checklist complete; all claims ✅ or labeled ⚠️; user has reviewed
- [ ] Sources section present
- [ ] Edge-state QA pass complete
- [ ] Banned-phrase scan of prose done
