# Share Crops v2

A mobile-first marketplace where neighbors in a local community list, trade, and
give away homegrown produce. Members post crop listings, make offers, message
each other, and rate completed trades.

This is a rebuild of the original `shareCropsApp`. It talks to the **same**
deployed Supabase backend out of the box, so it runs against live data with no
backend setup required.

## Highlights

- **Community marketplace** — browse and search crop listings, see what's in
  season, view listing details.
- **Offers** — make and manage offers on listings.
- **Direct messaging** — per-trade chat threads between members.
- **Ratings** — rate the other party after a trade completes.
- **Profiles & community setup** — onboarding flow that scopes a user to a
  community before they reach the app.
- **Resilient backend** — the frontend calls Supabase Edge Functions first and
  automatically fails over to a Vercel-hosted copy of the same backend on a 5xx
  or network error.

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, React Router 7, TanStack Query, Vite 6, TypeScript |
| Backend | [Hono](https://hono.dev) — one app running on two runtimes |
| Primary runtime | Supabase Edge Functions (Deno) |
| Fallback runtime | Vercel Serverless Functions (Node) |
| Data | Supabase Postgres + KV table + Storage |
| Auth | Supabase Auth (JWT) |
| E2E tests | Playwright |

## Project layout

```
src/
  screens/        Route-level views (Auth, Marketplace, ListingDetail,
                  Offers, Messages, ChatThread, Profile, CommunitySetup)
  components/     Layout, nav, cards, modals/sheets, atoms (Avatar, Icon, …)
  context/        AuthContext — auth state + setup gating
  hooks/          useMe and other data hooks
  lib/            api.ts (client + failover), supabase.ts, security, helpers
  config/         info.ts — Supabase project id + public anon key
server/
  entry.ts        Vercel Node entry — delegates to the shared Hono app
supabase/functions/
  _shared/        app.ts (the Hono backend), env, kv_store, security
  make-server-dd877831/   Deno Edge Function wrapper + deno.json import map
scripts/build-api.mjs     esbuild bundler: server/entry.ts -> api/index.js
tests/            Playwright specs (smoke, marketplace, screenshots, failover)
```

Routing (see [src/App.tsx](src/App.tsx)) gates the app in three stages:
unauthenticated users only reach `/login`; authenticated users without a
community are forced through `/community-setup`; everyone else gets the full
shell with bottom-nav routes.

## Getting started

### Prerequisites

- Node.js 20+
- npm

### Install & run

```bash
npm install
cp .env.example .env.local   # fill in the values below
npm run dev                  # Vite dev server on http://localhost:5173
```

By default the app points at the same live Supabase backend as the original
`shareCropsApp`, so it works immediately once the frontend env vars are set.

### Environment variables

Frontend (`VITE_`-prefixed, safe for the browser bundle):

| Var | Description |
|-----|-------------|
| `VITE_SUPABASE_PROJECT_ID` | Supabase project ref |
| `VITE_SUPABASE_ANON_KEY` | Supabase public anon key (RLS-scoped, safe to expose) |
| `VITE_FALLBACK_API_URL` | Vercel fallback base URL; leave blank to disable failover |

Server-only (no `VITE_` prefix — never shipped to the browser; set in your host's
env for production). The Supabase Edge runtime injects `SUPABASE_URL` and keys
automatically. See [.env.example](.env.example) and [DEPLOY.md](DEPLOY.md) for the
full list including `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_EMAIL`, `CORS_ORIGINS`,
and friends.

> The service-role / secret key is **never** committed. Rotate immediately if leaked.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check (`tsc --noEmit`) and build the SPA to `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run test:e2e` | Run the Playwright e2e suite |
| `npm run test:e2e:headed` | Run e2e tests in a headed browser |

## Architecture: dual-runtime backend

The **same** Hono app ([supabase/functions/_shared/app.ts](supabase/functions/_shared/app.ts))
runs on two runtimes against the same Supabase database:

```
            ┌──────────── Supabase (primary) ───────────┐
 frontend ──┤  Edge Function: make-server-dd877831       ├── Supabase DB
   │  └─ on 5xx / network error, fail over ↓             │   (Postgres + KV
   │        ┌──────────── Vercel (fallback) ─────────────┤    + Storage)
   └────────┤  /api  →  same Hono app (Node)             ├───┘
            └────────────────────────────────────────────┘
```

The frontend (`fetchWithFailover` in [src/lib/api.ts](src/lib/api.ts)) hits the
Supabase Edge Function first and transparently falls over to the Vercel copy on
failure. Because both runtimes share one database, the fallback stays useful even
when the Edge runtime is down. `tests/failover.spec.ts` forces the primary to 5xx
and asserts the app still loads via the fallback.

## Deployment

Full deployment instructions — Supabase Edge Function (primary) and Vercel (SPA +
fallback), required env vars, and the `scripts/build-api.mjs` bundling step — are
in [DEPLOY.md](DEPLOY.md).

## Testing

Playwright drives the e2e suite in [tests/](tests/): `smoke`, `marketplace`,
`screenshots`, and `failover`. Run with `npm run test:e2e`. Test artifacts
(`test-results/`, `playwright-report/`) are gitignored.
