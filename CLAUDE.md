# Cutaway — build conventions

Interactive explainers of backend/systems internals for senior engineers. Read `PRD.md` for product scope; read the
spec in `docs/superpowers/specs/` before changing platform decisions.

## Authoring explainers

Always use the `interactive-explainer` skill (`.claude/skills/interactive-explainer/`) when writing or editing an
explainer, building a visualization, or working on sim code. Its order of operations (interaction design → sim core →
visualization → prose → verification → QA) is non-negotiable.

## Commands

- `pnpm build` — static build (use this to verify changes; do NOT start `pnpm dev` without asking — the author
  usually has an instance running)
- `pnpm check` — astro check, strict TS
- `pnpm lint` / `pnpm format` — ESLint / Prettier
- `pnpm og` — regenerate `public/og.png` from `assets/og.svg`

## Platform rules

- Astro static output. Prose ships as zero-JS HTML; interactivity is React islands with `client:visible` only.
- Tailwind v4. All colors come from the tokens in `src/styles/global.css` (`--color-*`); never hardcode hex values in
  components. Semantic viz colors: ok (green), danger (red), pending (amber), entity (blue), dead (gray).
- Never use `@theme inline` in global.css — it inlines hex values into utilities and silently breaks the
  prefers-color-scheme dark overrides. Plain `@theme` only.
- Typography: IBM Plex Mono for headings/nav/metadata/figure labels/captions/controls; IBM Plex Sans for body prose.
- Light-first; dark theme only via `prefers-color-scheme` overrides in `global.css`. No theme toggle.
- Wrap every embedded visualization in `src/components/Figure.astro` (the `FIG. NN — LABEL` convention).
- Sim/render split: simulation logic is pure, deterministic, seeded TS with unit tests; React renders sim snapshots.
  System state never lives in `useState`.
- Rule of two: shared abstractions (`src/lib/sim/`, shared viz components) are extracted only when a second explainer
  needs them. Never pre-build.
- No banner/section-divider comments. Prefer no comments; when one is needed, state a constraint the code can't show.

## Content conventions

- One folder per explainer: `src/content/explainers/<slug>/` with `index.mdx`, `components/`, `sim/`, `further.md`.
- Frontmatter: `title`, `description`, `number` (roadmap #), `pubDate`, `updatedDate?`, `draft`.
- `draft: true` renders in dev only — excluded from build, home list, RSS, sitemap.
- Every explainer ends with a Sources section; claims are verified against primary sources before publishing.

## Deploy

Cloudflare Workers Builds, git-connected: push to `main` builds (`pnpm build`) and deploys production
(cutaway.gilla.fun). The committed `wrangler.jsonc` is load-bearing — it defines an assets-only Worker (`dist/`,
404-page handling) and overrides Cloudflare's auto-generated Astro config, which otherwise tries to provision a
SESSION KV namespace and fails on every rebuild. Node and pnpm versions are pinned via `.node-version` and
`packageManager` in package.json.
