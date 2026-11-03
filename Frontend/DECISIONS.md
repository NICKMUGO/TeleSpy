# Architecture decisions

Running log of choices made while building the TeleSpy frontend, and why.
Newest entries at the bottom. This feeds the capstone documentation directly.

## Phase 1 — Scaffold

### TanStack Table v9, not v8

The brief specified v8. The current published major on npm is
`@tanstack/react-table@9.1.2` — v8 is no longer the actively maintained line.
Confirmed with the project owner: use v9.

### shadcn/ui: CLI has moved past "new-york" / "default" styles

The brief asks for "`new-york` style, CSS variables enabled." The shadcn CLI
installed today (`shadcn@4.18.0`) no longer has that vocabulary — `--style`
is gone, replaced by named **presets** (`nova`, `vega`, `maia`, `lyra`,
`mira`, `luma`, `sera`, `rhea`), each bundling a component-primitive base
(Base UI / **Radix** / Aria), an icon library, a font, and a base color.
Initialized with the **Radix** primitive base (closest to what "shadcn/ui"
has always meant, and the safer accessibility bet — Radix primitives have
the longest track record) and the **nova** preset (the CLI's own
recommended default; already uses `lucide-react` and CSS variables, both
required by the brief regardless). This choice is low-stakes: Phase 2
rewrites essentially all color and font tokens with the Kenya Airways design
system anyway, so the preset only really decided the icon library (already
matched) and component-primitive base.

### Kenya Airways brand red: placeholder, unconfirmed

No access to KQ's internal brand guide. Shipping the brief's placeholder
(`≈#C8102E` → OKLCH) in `globals.css`, clearly marked unconfirmed. The
project owner will supply the authoritative value before Phase 2 finalizes
the design system.

### `output: "standalone"` in `next.config.ts`

The architecture puts an Nginx reverse proxy in front of the app (not
Vercel) — see the brief's tier table. `standalone` output produces a
self-contained `.next/standalone` build with a minimal `server.js`, suited
to container deployment behind a reverse proxy, without needing
`node_modules` on the target. Verified this option is unchanged in
Next.js 16 against the locally-vendored docs
(`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`).

### Node.js: engines >=20.9.0, CI pinned to Node 22

Next.js 16 requires Node ≥20.9. The dev machine had a non-LTS Node 23
installed; rather than requiring exactly that, `package.json#engines` states
the real minimum and CI (`.github/workflows/ci.yml`) pins Node 22 (current
LTS) so builds are reproducible regardless of what's on a given dev's
machine.

### Custom local ESLint rule for the hex-literal ban

The brief requires "an ESLint rule that fails the build on hex literals in
`.tsx` files." No suitable community plugin was in the approved library
list (§1), so `eslint-rules/no-hex-color-literals.mjs` is a small
zero-dependency flat-config rule: flags hex codes and `rgb()/rgba()/hsl()
/hsla()/oklch()` functional literals in string/template/JSX-attribute
values, scoped to `**/*.tsx`. It already caught the `create-next-app`
boilerplate's arbitrary-value Tailwind classes (`hover:bg-[#383838]`),
which is exactly the signal it's meant to catch — the boilerplate page was
replaced with a minimal placeholder using only semantic tokens.

### CI target: GitHub Actions

The repo has a `github.com/NICKMUGO/TeleSpy` remote, so CI is GitHub Actions.
Two jobs: (1) lint/format-check/typecheck/unit-test/build, (2) Playwright
E2E + axe-core accessibility checks (uploads the HTML report as an
artifact). The E2E job depends on the first job passing.

### Root layout gets a `<main>` landmark now, not later

Phase 1 scope is scaffold-only — the full app shell (header/nav/skip-link)
is Phase 3. But the axe-core smoke test caught a real violation (page
content with no landmark region) on the bare placeholder page, and "every
route has correct landmarks" is a non-negotiable baseline per the brief's
accessibility contract, not something to defer. Added a minimal `<main>`
wrapper in `src/app/layout.tsx`; the rest of the shell lands in Phase 3.

### Feature-first folder tree deferred to the phases that populate it

The brief's §5 architecture (`src/features/`, `src/components/{layout,data,
feedback}/`, `src/lib/{api,auth,format,copy}/`, etc.) is not created empty in
this phase. Next.js route folders and `lib/` subfolders will be created in
Phase 3 (app shell), Phase 5 (data layer) and Phase 6 (screens), each with
real content from the start — avoids empty placeholder directories/files
that would need `.gitkeep` filler and rework later.

## Phase 2 — Design system

### Full KQ token set, contrast-verified, not eyeballed

`src/app/globals.css` now carries the complete semantic token set from the
brief (`background` through `chart-5`, plus `warning`/`success`/`info` and
their foregrounds, which the shadcn-generated starting point didn't have).
`primary` and `destructive` intentionally resolve to the same brand red —
per the brief's own rule 2 ("genuine alerts" are one of red's listed uses)
and the signature-element rule ("when the eye catches red it always means
attention here"), splitting them into two different reds would dilute that
discipline. `ring` and chart colors deliberately stay off brand red so focus
indication and chart series don't compete with red's one meaning.

`scripts/check-contrast.mjs` (plain Node ESM, zero new dependencies — see
inline comment for why a hand-rolled OKLCH→luminance conversion was chosen
over adding a color library for a dev-only script) parses `globals.css`
directly and checks 19 token pairs per mode against WCAG 2.2 AA. It caught
two real problems before they shipped:

- Light-mode `--border` (`oklch(0.9 0 0)` on white) was 1.35:1 against the
  3:1 UI-boundary minimum — darkened to `oklch(0.62 0 0)` (3.64:1). Applied
  the same fix to `--input` and `--sidebar-border`.
- The script initially ignored alpha on the semi-transparent dark-mode
  border tokens (`oklch(1 0 0 / N%)`), which let their contrast come back
  falsely high. Fixed the script to alpha-composite over the background
  before computing luminance — that's what a browser actually paints — which
  then correctly caught `--sidebar-border` at 2.89:1; bumped its alpha
  10%→15% to clear 3:1.

Wired as `pnpm check-contrast`, and into CI between format-check and
typecheck.

### `/styleguide` shows light and dark side by side, not via a live toggle

The brief asks for tokens/components "side by side in light and dark." A
live theme toggle would need `next-themes` wired into the root layout
(provider, `suppressHydrationWarning`, FOUC-safe inline script) — that's
explicitly Phase 3 scope. Instead the page renders its content twice inside
two scoped panels, the second wrapped in a plain `<div className="dark">`.
Tailwind's `.dark` selector sets the dark custom properties on that element
directly, and descendants inherit them via normal CSS custom-property
inheritance — no theme provider needed for a static side-by-side review.
Phase 3's theme toggle is a separate, additive concern (app-wide light/dark
switching), not a prerequisite for this page.

### `next start` warns under `output: "standalone"` — left as is for now

Next.js warns that `next start` doesn't exercise the standalone server built
by `output: "standalone"` (Phase 1 decision, kept for the Nginx-fronted
deployment target); the real entrypoint there is
`node .next/standalone/server.js` after copying `public/` and
`.next/static` in. `next start` still serves the app correctly for local
dev/test/Playwright use — the warning is cosmetic in that context — and no
Dockerfile or deployment pipeline exists yet in this frontend-only repo's
build order, so switching `pnpm start` / Playwright's `webServer` over to
the standalone entrypoint is deferred until there's an actual container
build step that needs it.

**Update (Nov 2026):** the copy is now part of the build. `pnpm build` runs
`scripts/copy-standalone-assets.mjs` after `next build`, so
`.next/standalone` always contains `public/` (the PWA's `sw.js`,
`offline.html`) and `.next/static`, and runs as-is with
`pnpm start:standalone` (`node .next/standalone/server.js`). A deploy only
has to ship the `.next/standalone` folder. `pnpm start` stays `next start`
for local use and Playwright.

## Phase 3 — App shell

### Repo relocated mid-build: `.claude/worktrees/frontend-scaffold` → `Frontend/worktrees/frontend-scaffold`

Not a code decision, but worth recording since it briefly broke the build:
the project owner moved the working directory outside this session's control
partway through Phase 3. Git's worktree metadata (`.git/worktrees/*/gitdir`)
still pointed at the old path; `git worktree repair` fixed the pointer, and
a stale `node_modules/vitest/config.d.ts` proxy file (a pnpm-generated
re-export that had baked in the old absolute path) needed a full
`rm -rf node_modules && pnpm install` to regenerate correctly. Also removed
`CLAUDE.md`/`AGENTS.md` (Next.js's own AI-agent instruction files) per the
project owner's request to keep the repo free of AI-tooling fingerprints.

### shadcn's `sidebar`, `command`, and `card` components had real bugs — fixed in place

Since these are ours to own and customize (§1), fixed rather than worked
around:

- **`SidebarInset` rendered its own `<main>`**, which would have nested
  inside the app's real `<main id="main-content">` (invalid HTML, and the
  topbar would incorrectly become a descendant of `main` instead of a
  sibling `<header>`). Changed it to a plain `<div>` — the real `<main>`
  landmark is drawn once, in `AppShellChrome`, around route content only.
- **`CommandDialog` never wrapped its children in `<Command>`** (the cmdk
  context provider) — every `CommandInput`/`CommandList`/`CommandItem`
  threw `Cannot read properties of undefined (reading 'subscribe')` the
  moment the palette opened, because they read from a cmdk context that
  didn't exist. Wrapped `{children}` in `<Command>` inside `CommandDialog`.
- **`CommandDialog`'s sr-only `DialogHeader`** (title/description) was a
  sibling of the portaled `DialogContent`, not inside it — rendering
  directly under `<body>`, outside every landmark, and failing axe's
  `region` check even while visually hidden. It's also _always_ in the DOM
  regardless of open state, since only `DialogContent` is
  presence-controlled. Moved it to be the first child inside
  `DialogContent`.
- **`CardTitle` only ever rendered a `<div>`**, no matter what — fine for
  cards inside a page that already has its own heading elsewhere, but wrong
  for the login page, where the card title _is_ the page's `<h1>` (axe
  correctly flagged the missing heading). Added `asChild` support (same
  `Slot` pattern as `Button`/`Badge`) so a real heading tag can be passed in
  where a card title needs to carry a genuine heading level.

None of these surfaced in isolated component review — all four were only
caught by actually exercising the shell with Playwright + axe (`pnpm
test:e2e`), which is exactly why that suite runs against the real rendered
app rather than relying on lint/typecheck alone.

### Sidebar landmark: whole surface is one `<nav>`, not just the menu

shadcn's `Sidebar` primitive renders plain `<div>`s throughout — no `<nav>`
landmark anywhere. Initially wrapped only the menu list, leaving the
brand/logo link in `SidebarHeader` outside any landmark (axe: "page content
not contained by landmarks"). Wrapping the whole sidebar surface (brand +
nav items) in one `<nav aria-label="Primary">` in `AppSidebar` was simpler
and correct — the brand link isn't meaningfully separate from the
navigation below it.

### Breadcrumb list markup: no wrapper `<span>` around item+separator pairs

`BreadcrumbItem` and `BreadcrumbSeparator` both render `<li>` directly (the
separator is `role="presentation"`, not decoration bolted onto the item).
Wrapping each item+separator pair in a `<span>` to group them for layout
purposes put a non-`<li>` node directly inside the `<ol>` — invalid list
markup, caught by axe's `listitem`/`only-listitems` rules. Fixed by making
`BreadcrumbItem` and `BreadcrumbSeparator` direct siblings inside
`BreadcrumbList`, using `key`ed `Fragment`s instead of a wrapping element.

### Skip link target needs `tabIndex={-1}` to actually receive focus

A skip link's `href="#main-content"` only _scrolls_ to the target unless
that target is focusable — browsers only move keyboard focus to a fragment
target that has (or gains) a `tabindex`. Added `tabIndex={-1}` plus a
`focus-visible` ring to both `<main id="main-content">` elements (app shell
and auth layout) so the skip link is actually operable, not just present.
Verified with a real keyboard-only Playwright test (`app-shell.spec.ts`),
not just an axe scan — axe cannot catch "the target isn't focusable," only
a real Tab-then-Enter sequence can.

### Next.js 16.3 error-boundary props: `retry`, not `reset`

`retry` became the stable prop on `error.js`/`global-error.js` in
**v16.3.0** — this exact installed version. `reset` still works (the docs
call it a fallback for a narrower case) but the current guidance is "use
`retry()` instead" for the common case. Used `retry` throughout (all 13
`error.tsx` boundaries plus `global-error.tsx`), confirmed against the
locally-vendored docs rather than assumed from prior Next.js versions.

### Route-group layouts can't use the `LayoutProps<'/path'>` codegen helper

`LayoutProps<T>` is constrained to `LayoutRoutes`, which Next's typegen only
populates for layouts tied to one specific path (e.g. a root layout, or
`app/dashboard/layout.tsx`). A route-group layout like `(app)/layout.tsx`
applies to a dozen different leaf routes at once, so it has no single path
key — `.next/types/routes.d.ts` only ever contains `type LayoutRoutes =
"/"`. Both route-group layouts use plain `{ children: ReactNode }` typing
instead.

### Mock current user and RBAC-as-UI-convenience, ahead of the real data layer

The sidebar needs _a_ role to filter nav items by, and the brief is explicit
that UI-level RBAC is a convenience, not a control (the API enforces it).
Added `src/lib/auth/mock-user.ts` — a single hardcoded `CurrentUser`,
clearly commented as a Phase-5 replacement point — rather than either
blocking the shell on real auth or leaving role-gating unimplemented until
later. `isNavItemVisible()` is unit-tested now so the filtering logic itself
is already correct when Phase 5 swaps the mock for a real session.

### Login is a real, working form now, not a stub

Unlike the other Phase 3 nav destinations (deliberately left as labeled
placeholders — see the Phase 2 entry on scope), `/login` got a real
react-hook-form + Zod form wired up. Two reasons: it's one of Phase 7's
three required E2E flows ("login → dashboard"), so building it for real now
means that flow already exists to test against later; and it's a clean,
self-contained way to establish the brief's form pattern (Zod schema as the
single source of truth, `aria-describedby`-linked errors) before Phase 6
needs it repeatedly. It has no real backend — submission just toasts and
navigates to `/dashboard` — clearly commented as a Phase 5 replacement
point, same as the mock user.

### Sidebar nav never scrolls internally

shadcn's `SidebarContent` ships with `overflow-auto` so the nav list scrolls
independently if it's taller than the viewport. Per the project owner's
explicit preference, changed to `overflow-visible` in
`components/ui/sidebar.tsx` — the current 12-item nav fits comfortably on
any real screen, so the tradeoff (nav could visually overflow past the
sidebar's fixed height on an extremely short viewport, rather than scroll)
is acceptable. If the nav grows enough to matter, revisit rather than
silently reintroducing scroll.

### `/settings` reuses the Display Settings dialog's controls, not a second copy

Extracted the theme/font-size/density/motion controls out of
`DisplaySettingsDialog` into `DisplaySettingsForm`, used both inside the
quick-access dialog and directly on the `/settings` page (alongside stub
sections for notifications and tariff plans, which have no state to manage
yet). One control implementation, two places it's reachable from, matching
the brief's own requirement that the panel be reachable from both the user
menu and a dedicated settings surface.
