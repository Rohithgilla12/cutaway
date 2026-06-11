# Cutaway — PRD

> Working title. "Cutaway" as in a cutaway diagram: the site shows the internals of systems infrastructure with the casing removed. Rename if a better name lands.

## One-liner

Interactive explainers of backend/systems internals — WALs, Raft, workflow engines, connection pooling, LSM trees — for senior engineers, in the style of smudge.ai's rate-limiting post and samwho.dev, but aimed one level deeper.

## Why this exists

1. **The niche is underserved at the senior level.** Existing interactive explainers (samwho.dev, smudge.ai, PlanetScale's B-tree posts) prove the format works, but most target intermediate topics. Almost nobody has done "how a write-ahead log survives a torn page" or "how Temporal's deterministic replay actually works" interactively.
2. **It is the public output of the author's Kronos learning plan.** Every explainer corresponds to material from DDIA (2nd ed.), Database Internals (Petrov), or the Kronos workflow-engine build. The site is proof-of-work for distributed-systems depth.
3. **Teaching artifact for others.** Each piece should be the page a senior dev sends a teammate instead of explaining the concept in a meeting.

## Audience

Senior engineers who have shipped production systems. Assume the reader:

- Knows what a transaction, an index, and a mutex are. Never explain these.
- Has been paged at 3 AM. Failure modes are the most interesting part, not an afterthought.
- Is allergic to fluff, marketing tone, and "in today's fast-paced world" openers.

Explicit non-audience: beginners, bootcamp-level content, "what is an API" territory.

## Product principles

1. **One interaction per explainer is the soul of the piece.** Every explainer is designed around a single core interactive visualization where the reader can *break* the system and watch what happens (kill the process mid-fsync, partition the Raft leader, saturate the pool). Secondary visualizations support; the core interaction teaches.
2. **Correctness over speed.** Every technical claim is verified against primary sources (Postgres source/docs, the Raft paper, Temporal docs, PgBouncer docs) before publishing. A wrong explainer is worse than no explainer. Each piece ships with a "Sources" section.
3. **Reading-flow first.** Prose carries the argument; visualizations are embedded where they answer the question the prose just raised. Never a wall of demos, never a wall of text.
4. **Boring platform, exceptional content.** The site shell is deliberately minimal. No CMS, no comments, no accounts, no custom animation framework. All engineering effort goes into the explainers themselves.

## Scope

### v1 (ship gate: explainer #1 published)

- Astro site: home page (list of explainers), explainer page template, about page, RSS feed.
- One published explainer: **"How a write-ahead log survives a crash"** (see roadmap).
- The `interactive-explainer` skill is exercised and refined while building it.
- OG image per post (static template is fine for v1).
- Deployed to Vercel on a custom domain.

### v1 non-goals (explicitly out)

- Dark/light theme toggle beyond `prefers-color-scheme` defaults.
- Search, tags, newsletters, analytics dashboards, comments.
- Custom animation/visualization framework or component library beyond what explainer #1 needs. Shared abstractions are extracted *after* explainer #2 proves they repeat (rule of two).
- i18n, CMS, MD editor tooling.

### Later (v2+)

- Per-post interactive "playground" sections (smudge.ai-style free-play area at the end).
- Series grouping (e.g., a "Workflow Engines" series tied to Kronos).
- Lightweight analytics (Plausible/Umami class) to learn which interactions get used.

## Content roadmap

Ordered to track the author's reading plan. Each row names the core interaction up front, because that decision gates writing.

| # | Explainer | Core interaction (what the reader breaks) | Primary sources |
|---|-----------|-------------------------------------------|-----------------|
| 1 | How a write-ahead log survives a crash | A live WAL + data-page view; reader can `kill -9` the process at any instant (including mid-write) and replay recovery step by step. Toggle fsync off and watch durability silently break. Show group commit batching under load. | Postgres WAL docs & source comments, DDIA ch. 3, Database Internals part I |
| 2 | Raft leader election, but you control the network | Cluster of 5 nodes; reader partitions links, drops/delays packets, kills leaders. Election timers visible. Reader tries to cause split-brain and the protocol visibly refuses. | Raft paper (Ongaro & Ousterhout), raft.github.io |
| 3 | What PgBouncer actually does to your connections | Clients → pooler → Postgres backends as live lanes. Switch session/transaction/statement modes and watch reuse patterns change. Trigger the prepared-statement failure in transaction mode. Saturate the pool, watch queueing and timeouts. | PgBouncer docs, Postgres protocol docs |
| 4 | How durable workflow engines replay history (Temporal internals) | A workflow's event history as a tape; reader crashes the worker mid-workflow, watches deterministic replay reconstruct state. Introduce non-determinism (e.g., a naked `time.Now()`) and watch replay diverge and fail. | Temporal docs/architecture posts, Kronos build notes |
| 5 | LSM trees: write fast now, pay later | Writes flow into a memtable; reader triggers flushes and watches compaction merge SSTables. Read-amplification meter. Compare a point-read path before/after compaction. | Database Internals part I, RocksDB wiki, DDIA ch. 3 |
| 6 | MVCC, or: why your table is 3× bigger than your data | Tuple versions accumulating under concurrent transactions; reader holds a long transaction open and watches vacuum get blocked, bloat grow, and xid horizon stall. | Postgres MVCC/vacuum docs, internals book (interdb.jp) |

Cadence target: one explainer every 3–4 weeks. Depth over schedule — slipping a week is fine; shipping a wrong one is not.

## Technical decisions

- **Framework**: Astro (latest stable) + MDX content collections. Static output. React islands (`client:visible`) for interactive components only; explainer prose ships as zero-JS HTML.
- **Language/tooling**: TypeScript strict, pnpm, Tailwind CSS v4, Prettier + ESLint.
- **Visualization**: SVG + `requestAnimationFrame` driven by a small per-component state machine for most visualizations; `<canvas>` only when element count makes SVG DOM cost prohibitive (hundreds+ of animated entities). No d3 dependency unless a specific explainer genuinely needs scales/shapes — and then import only the submodule.
- **Simulation/render split**: every interactive component separates a pure, deterministic simulation core (plain TS, unit-testable, seeded RNG) from the rendering layer. This is non-negotiable — it is what makes the visualizations correct and testable rather than animation theater.
- **Accessibility/perf**: honor `prefers-reduced-motion` (fall back to stepped, button-driven states — the explainer must still teach with animation off). Interactions must work on mobile touch (a large share of HN/Twitter traffic is mobile). Lighthouse ≥ 95 on explainer pages.
- **Hosting**: Vercel, custom domain, static.
- **Repo layout**:

```
cutaway/
├── PRD.md                      # this file
├── CLAUDE.md                   # build conventions for Claude Code (generate during setup)
├── .claude/skills/
│   └── interactive-explainer/  # the authoring skill (provided)
├── src/
│   ├── content/explainers/     # one folder per explainer: index.mdx + components/
│   ├── components/             # shared site components only (Layout, Prose, Footnote…)
│   ├── lib/sim/                # shared simulation utilities IF AND ONLY IF reused twice
│   └── pages/
└── …
```

## Quality bar / definition of done (per explainer)

An explainer ships only when all of the following hold:

1. **Core interaction exists and teaches.** A reader who only plays with the visualizations and reads captions still learns the central idea.
2. **The reader can break it.** At least one failure mode is explorable, not just described.
3. **Verified.** Every technical claim checked against the primary sources listed for that explainer; a `Sources` section cites them. Any simplification is labeled as one ("real Postgres also does X; we omit it here").
4. **Human-reviewed.** The author has read every sentence and personally exercised every interaction state, including edge states (pause mid-animation, spam the buttons, resize, reduced motion, mobile).
5. **Simulation core has unit tests.** The deterministic sim logic (not the rendering) is covered for its main invariants — e.g., "recovery after crash at any LSN yields consistent state."
6. **Performance**: no jank at 60fps on a mid-range phone for the default animation; page interactive < 2s.

## Milestones

1. **M0 — Scaffold** (1–2 sessions): Astro site, layout, typography, explainer template, deploy pipeline. Deliberately plain.
2. **M1 — Explainer #1 sim core** : WAL simulation as pure TS with tests (append, fsync semantics, crash at arbitrary point, recovery replay, group commit). No UI yet.
3. **M2 — Explainer #1 visualization + prose**: build the interactive components on the sim core, write the prose, integrate.
4. **M3 — Verify & ship**: source verification pass, edge-state QA, OG image, publish, post to HN/Twitter.
5. Repeat M1–M3 per explainer; extract shared abstractions only when the second explainer demands them.

## Success metrics (12 months)

- 6+ explainers published.
- At least one front-page HN appearance or equivalent organic spike.
- Used as a reference in real hiring conversations (Toptal/direct) — the site appears in the author's profile and gets cited back.
- Zero published technical errors requiring retraction (corrections via errata notes are fine and expected).

## Risks

| Risk | Mitigation |
|------|------------|
| Platform polishing displaces content (documented pattern) | M0 is timeboxed; non-goals list is binding; explainer #1 is the only v1 ship gate |
| Subtly wrong AI-drafted content damages credibility | Definition-of-done items 3–5; sim core is tested code, not hand-waved animation |
| Interactions are pretty but don't teach | "One interaction per explainer" principle; core interaction is designed and approved *before* prose is drafted |
| Scope creep per explainer | Each explainer answers one question; adjacent material becomes a future explainer, listed in a `further.md` parking lot |
