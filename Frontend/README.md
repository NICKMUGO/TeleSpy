# TeleSpy — Frontend

AI-driven SIM management and telecom cost accountability system, built for
Kenya Airways as a university capstone project. This repo is the presentation
layer only — a role-gated Next.js client with no business logic. It talks to
an ASP.NET Core 8 API (not yet built) through a typed client with a mock
adapter, so the whole app runs and reviews offline today and switches to the
real backend by flipping `NEXT_PUBLIC_USE_MOCKS`.

See the project brief for full context and `DECISIONS.md` for the rationale
behind choices made while scaffolding.

## Stack

Pinned to the exact versions installed as of this scaffold:

| Package                | Version |
| ---------------------- | ------- |
| next                   | 16.3.1  |
| react / react-dom      | 19.2.8  |
| typescript             | 5.9.3   |
| tailwindcss            | 4.3.3   |
| shadcn (CLI)           | 4.18.0  |
| next-themes            | 0.4.6   |
| @tanstack/react-query  | 5.101.4 |
| @tanstack/react-table  | 9.1.2   |
| zustand                | 5.0.15  |
| react-hook-form        | 7.85.0  |
| zod                    | 4.4.3   |
| @hookform/resolvers    | 5.9.0   |
| recharts               | 3.10.1  |
| lucide-react           | 1.31.0  |
| sonner                 | 2.0.8   |
| date-fns               | 4.4.0   |
| vitest                 | 4.1.10  |
| @testing-library/react | 16.3.2  |
| @playwright/test       | 1.62.1  |
| @axe-core/playwright   | 4.13.0  |
| eslint                 | 9.39.5  |
| prettier               | 3.9.6   |

Package manager: **pnpm** (`pnpm@11.22.0`, enable with `corepack enable` or
`npm install -g pnpm`).

## Getting started

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open http://localhost:3000.

## Scripts

| Command                        | Does                                                             |
| ------------------------------ | ---------------------------------------------------------------- |
| `pnpm dev`                     | Start the dev server (Turbopack)                                 |
| `pnpm build`                   | Production build (`output: "standalone"`)                        |
| `pnpm start`                   | Run the production build                                         |
| `pnpm lint`                    | ESLint (flat config), includes the no-raw-color-literal rule     |
| `pnpm typecheck`               | `tsc --noEmit`                                                   |
| `pnpm format` / `format:check` | Prettier (writes / checks)                                       |
| `pnpm test`                    | Vitest unit tests                                                |
| `pnpm test:watch`              | Vitest in watch mode                                             |
| `pnpm test:coverage`           | Vitest with v8 coverage                                          |
| `pnpm test:e2e`                | Playwright E2E + axe-core accessibility checks                   |
| `pnpm check-contrast`          | WCAG 2.2 AA contrast gate over every token pair in `globals.css` |

A Husky `pre-commit` hook runs `lint-staged` (ESLint + Prettier on staged
files).

## Environment variables

See `.env.example`:

- `NEXT_PUBLIC_API_URL` — base URL of the ASP.NET Core API.
- `NEXT_PUBLIC_USE_MOCKS` — `true` to run entirely against the seeded mock
  adapter (`src/lib/api/mock/`, added in the data-layer phase) instead of a
  real backend.

## Design system

Colors live in exactly one place: `src/app/globals.css` under `@theme`. An
ESLint rule (`eslint-rules/no-hex-color-literals.mjs`) fails the build on any
raw hex/rgb/hsl/oklch literal found in a `.tsx` file — components must use
semantic classes (`bg-primary`, `text-foreground`, `border-destructive`, …)
instead. The Kenya Airways brand red currently in the tokens file is a
**placeholder pending confirmation against the official brand guide**.

Every token pair is checked against WCAG 2.2 AA by `pnpm check-contrast`
(`scripts/check-contrast.mjs`) — see `/styleguide` for every color token,
type scale step, and component variant rendered side by side in light and
dark. That page is how the design gets reviewed.

## App shell

`/` redirects to `/dashboard`. Every nav destination in the brief exists as
a route today (sidebar, topbar, breadcrumbs, user menu) — most render a
labeled placeholder until Phase 6 builds their real content; `/login` and
`/settings` are fully working. Keyboard shortcuts: `Ctrl/Cmd+K` command
palette, `Ctrl/Cmd+,` display settings, `?` shortcuts help, `Ctrl/Cmd+B`
toggle sidebar — all documented in the shortcuts dialog itself.

RBAC in the sidebar (`src/components/layout/nav-items.ts`) is driven by a
hardcoded mock user (`src/lib/auth/mock-user.ts`) and is a UI convenience
only, per the brief — the API is what actually enforces access, once it
exists.

## CI

`.github/workflows/ci.yml` runs on every push to `main` and every PR: lint,
format check, WCAG AA contrast check, typecheck, unit tests, build, then
Playwright E2E + axe accessibility checks in a second job.
