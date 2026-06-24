# Share Crops v2

A mobile-first marketplace where neighbors in a local community list, trade, and
give away homegrown produce. Members post crop listings, make offers, message
each other, and rate completed trades.

This is a rebuild of the original `shareCropsApp` at https://github.com/gilbertanderson/share-crops-app.
The app uses Firebase Auth in the browser and one Hono/Node API backend for
marketplace behavior. Supabase is used by the backend for Postgres and Storage.

## Highlights

- **Community marketplace** — browse and search crop listings, see what's in
  season, view listing details.
- **Offers** — make and manage offers on listings.
- **Direct messaging** — per-trade chat threads between members.
- **Ratings** — rate the other party after a trade completes.
- **Profiles & community setup** — onboarding flow that scopes a user to a
  community before they reach the app.
- **Portable backend** — one Hono API runs on Node, deployed to Vercel now and
  structured so it can move to a container host later.

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | React 18, React Router 7, TanStack Query, Vite 6, TypeScript |
| Backend | [Hono](https://hono.dev) on Node |
| Runtime | Vercel Serverless Functions now; portable Node host/container later |
| Data | Supabase Postgres + Storage |
| Auth | Firebase Auth + Firebase Admin token verification |
| E2E tests | Playwright |

## Project layout

```
src/
  screens/        Route-level views (Auth, Marketplace, ListingDetail,
                  Offers, Messages, ChatThread, Profile, CommunitySetup)
  components/     Layout, nav, cards, modals/sheets, atoms (Avatar, Icon, …)
  context/        AuthContext — auth state + setup gating
  hooks/          useMe and other data hooks
  lib/            api.ts (single backend client), firebaseAuth, helpers
server/
  app.ts          Hono routes and marketplace behavior
  db.ts           Supabase Postgres data-access layer
  entry.ts        Vercel Node entry
  firebaseAdmin.ts Firebase ID-token verification
supabase/migrations/
                  Canonical database schema history
scripts/build-api.mjs     esbuild bundler: server/entry.ts -> api/index.js
tests/            Playwright specs (smoke, marketplace, screenshots)
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

The browser uses Firebase Auth and sends all marketplace requests to the Node
API. Supabase is used by the server for Postgres and Storage.

### Environment variables

Frontend (`VITE_`-prefixed, safe for the browser bundle):

| Var | Description |
|-----|-------------|
| `VITE_FALLBACK_API_URL` | Optional API base override; leave blank for same-origin `/api/make-server-dd877831` |

Server-only (no `VITE_` prefix — never shipped to the browser; set in your host's
env for production). See [.env.example](.env.example) and [DEPLOY.md](DEPLOY.md)
for the full list including `FIREBASE_SERVICE_ACCOUNT`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `ADMIN_EMAIL`, `CORS_ORIGINS`,
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

## Architecture: single Node backend

The browser sends Firebase ID tokens to the Node API. The API verifies them with
Firebase Admin and owns all marketplace reads/writes against Supabase.

```
PWA frontend
  └─ Firebase Auth token
      └─ /api/make-server-dd877831/*
          └─ Hono/Node API
              ├─ Firebase Admin token verification
              ├─ Supabase Postgres
              └─ Supabase Storage
```

Supabase Edge Functions are no longer an application runtime for this repo.
Supabase remains the database/storage provider.

## Deployment

Full deployment instructions are in [DEPLOY.md](DEPLOY.md).

## Testing

Playwright drives the e2e suite in [tests/](tests/): `smoke`, `marketplace`,
and `screenshots`. Run with `npm run test:e2e`. Test artifacts
(`test-results/`, `playwright-report/`) are gitignored.
