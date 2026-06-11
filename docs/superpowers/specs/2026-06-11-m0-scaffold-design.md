# M0 Scaffold — Design

Date: 2026-06-11
Status: approved
Scope: PRD milestone M0 — Astro site shell, layout, typography, explainer template, deploy pipeline. Deliberately plain; explainer content is out of scope (M1+).

## Decisions made during brainstorming

| Decision | Choice | Notes |
|---|---|---|
| Name | **Cutaway** (committed, no longer a working title) | Renaming later is cheap if needed |
| Domain | **cutaway.gilla.fun** | User-owned, on Cloudflare |
| Hosting | **Cloudflare Pages** | Overrides PRD's "Vercel"; PRD should be treated as superseded on this point |
| Design direction | **Terminal mono + figure labels, light-first** | Mono for all structure, readable sans for body; `FIG. NN` annotation on visualizations; dark theme via `prefers-color-scheme` |
| Fonts | **IBM Plex Mono** (structure) + **IBM Plex Sans** (body) | Self-hosted via @fontsource, latin subset, woff2, preload. Reference sites: datapeek.dev (Geist Mono), opencode.ai (IBM Plex Mono/Sans) |
| Approach | From-scratch minimal Astro | No blog template; every line intentional |
| Repo | GitHub `Rohithgilla12/cutaway`, public | Required for Cloudflare Pages git integration; site is proof-of-work |

## 1. Stack

- Astro latest stable (v5 line), static output, TypeScript strict, pnpm.
- Integrations: `@astrojs/mdx`, `@astrojs/react` (islands only), `@astrojs/rss`, `@astrojs/sitemap`.
- Tailwind CSS v4 via `@tailwindcss/vite`.
- Prettier + ESLint (flat config).
- Vitest deferred to M1 (arrives with the first sim core).

## 2. Repo layout

```
cutaway/
├── PRD.md
├── CLAUDE.md                        # generated in M0: build conventions
├── .claude/skills/interactive-explainer/
│   ├── SKILL.md                     # moved from repo root
│   └── references/viz-patterns.md   # moved from repo root (path the skill references)
├── src/
│   ├── content/explainers/          # empty in M0; content.config.ts defines schema
│   ├── components/                  # Layout, Header, Footer, Figure, PostMeta
│   ├── pages/                       # index.astro, about.astro, 404.astro, rss.xml.ts
│   └── styles/global.css            # tokens + theme + prose styles
└── …
```

- `src/lib/sim/` is NOT created in M0 (rule of two — extracted only when explainer #2 needs shared code).
- `.superpowers/` (brainstorm artifacts) is gitignored.

## 3. Content model

- One content collection `explainers`. Schema (zod): `title` (string), `description` (string), `number` (int — roadmap #), `pubDate` (date), `updatedDate` (date, optional), `draft` (boolean, default false).
- Slug = folder name: `src/content/explainers/<slug>/index.mdx`. Explainer-specific components and sim code live beside it (`components/`, `sim/`) per the interactive-explainer skill's file conventions.
- Drafts render in dev; excluded from production build, home list, RSS, and sitemap.
- Home page: list of published explainers, newest first, with number, title, description, date.
- About page: short static page.
- RSS at `/rss.xml`; sitemap via integration.
- OG image: one static site-wide image in M0. Per-post OG images land in M3.

## 4. Design system

- **Type**: IBM Plex Mono for headings, nav, metadata, figure labels, viz captions and controls. IBM Plex Sans for body prose. Body measure ~65ch.
- **Theme**: light-first. All colors are CSS custom properties in `global.css`; dark theme overrides via `@media (prefers-color-scheme: dark)`. No theme toggle (PRD non-goal).
- **Semantic viz tokens** (from viz-patterns.md, defined site-wide in M0 so every future component inherits them): green = allowed/committed/durable, red = blocked/failed/lost, amber = pending/in-flight/unsynced, blue = neutral/reader-controlled, gray = dead/partitioned/stale.
- **Figure component**: `Figure.astro` wraps any embedded island with a thin border, a mono `FIG. NN — LABEL` annotation, and a caption slot. This is the site's signature visual convention.
- **Prose styles**: hand-rolled in `global.css` (~40 lines), not `@tailwindcss/typography` — the mono-heading/sans-body split would mean overriding half the plugin.
- Tailwind v4 `@theme` maps the CSS custom properties so utilities and tokens stay in sync.

## 5. Explainer page template

Header: explainer number + title (mono), date + reading time (mono, muted). Body: MDX prose (sans) with `Figure`-wrapped React islands (`client:visible`). Footer of post: Sources section (mandatory per PRD). No prev/next navigation in M0.

## 6. Deploy pipeline

- GitHub repo connected to Cloudflare Pages: build `pnpm build`, output `dist/`, production branch `main`, automatic preview deploys on other branches.
- Custom domain `cutaway.gilla.fun` attached in the Pages dashboard (CNAME on the gilla.fun Cloudflare zone).
- `site: "https://cutaway.gilla.fun"` in `astro.config.ts` drives RSS, sitemap, and canonical URLs.
- No GitHub Actions in M0.

## 7. Quality gates (M0 definition of done)

1. `astro check` clean under strict TS; ESLint and Prettier clean; `pnpm build` succeeds.
2. Real 404 page.
3. Manual Lighthouse run ≥ 95 on the deployed home page.
4. `cutaway.gilla.fun` serves home, about, 404, and RSS in the locked design.
5. Skill files moved into `.claude/skills/interactive-explainer/` and `CLAUDE.md` written.

## Out of scope for M0

Explainer content (M1–M3), Vitest, GitHub Actions CI, per-post OG generation, theme toggle, search/tags/analytics/newsletter (PRD non-goals), shared sim utilities.
