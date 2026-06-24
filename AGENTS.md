# AGENTS.md

## Cursor Cloud specific instructions

Share Crops v2 is a single product: a React 18 + Vite 6 SPA frontend (`src/`) plus
one Hono/Node API backend (`server/`). Firebase Auth runs in the browser; the
backend verifies Firebase ID tokens and reads/writes Supabase Postgres + Storage.
Standard commands live in `README.md` (Scripts table) and `package.json`; deploy
details are in `DEPLOY.md`. Package manager is **npm** (only `package-lock.json`).

### Services and how to run them

| Concern | Command | Notes |
|---|---|---|
| Frontend dev server | `npm run dev` | Vite SPA on `http://localhost:5173`. Serves **only** the SPA — `vite.config.ts` has no `/api` proxy, so same-origin `/api/make-server-dd877831` calls are NOT served by Vite alone. |
| Typecheck + build | `npm run build` | `tsc --noEmit` (frontend only) then `vite build`. There is **no separate lint script**; this is the closest thing to a lint/typecheck gate. `server/app.ts` and `server/db.ts` use `// @ts-nocheck`, so the backend is not type-checked. |
| E2E tests | `npm run test:e2e` | Playwright (Chromium). The webServer auto-starts `npx vite` on port **4321** and sets `VITE_FALLBACK_API_URL=https://fallback.test/...`. Run `npx playwright install --with-deps chromium` once if browsers are missing. |
| Backend API | (no standalone dev script) | Runs as a Vercel serverless function. Locally it requires `vercel dev` (CLI is a devDep) or pointing the SPA at a deployed backend via `VITE_FALLBACK_API_URL`. It **throws on startup** if `ADMIN_EMAIL`, `APP_ID`, `STORAGE_BUCKET_NAME`, `KV_TABLE_NAME`, or `CORS_ORIGINS` are unset. |

### Critical gotchas

- **The SPA crashes at boot without `VITE_FIREBASE_*` config.** `src/lib/firebase.ts`
  calls `getAuth()` at import time; with empty config it throws `auth/invalid-api-key`
  and renders a blank page (all e2e tests time out). A gitignored `.env.local` with
  **dummy** `VITE_FIREBASE_*` values (they are public, not secrets) is enough to let
  the SDK initialize so the SPA boots and the login/sign-up UI works. Real values are
  only needed to actually authenticate. `.env.local` is gitignored and is NOT created
  by the update script, so create it on a fresh VM if missing (any non-empty
  placeholders work):

  ```bash
  [ -f .env.local ] || cat > .env.local <<'EOF'
  VITE_FIREBASE_API_KEY=AIzaSyDUMMY-localdev-key-000000000000000
  VITE_FIREBASE_AUTH_DOMAIN=demo-sharecrops.firebaseapp.com
  VITE_FIREBASE_PROJECT_ID=demo-sharecrops
  VITE_FIREBASE_STORAGE_BUCKET=demo-sharecrops.appspot.com
  VITE_FIREBASE_MESSAGING_SENDER_ID=000000000000
  VITE_FIREBASE_APP_ID=1:000000000000:web:0000000000000000000000
  EOF
  ```
- **Authenticated flows need real Firebase + Supabase credentials.** `AuthContext`
  derives auth state solely from Firebase `onAuthStateChanged`; the marketplace,
  offers, messages, profile, and listing screens only render after a real
  email-verified Firebase sign-in (the backend rejects unverified tokens), and the
  backend then needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` etc. (see
  `.env.example` / `DEPLOY.md`). Without these secrets the app stays on `/login`.
- **Some e2e specs are stale vs. the Firebase migration.** `tests/marketplace.spec.ts`,
  `tests/failover.spec.ts`, `tests/_cap.spec.ts`, and the happy-path signup test in
  `tests/auth-firebase.spec.ts` only `seedAuth()` a `localStorage` token, which the
  current `AuthContext` ignores — so they cannot reach the authenticated app and fail
  without a real Firebase session. The genuinely-runnable specs (login UI, client-side
  validation, screenshot capture) pass once dummy `VITE_FIREBASE_*` is set.
- **`api/index.js` is generated** (gitignored) by `node scripts/build-api.mjs`; the
  Vercel `buildCommand` runs it before `vite build`. `npm run build` does not.
- **Docs drift:** `DEPLOY.md` still describes a dual-runtime Supabase-Edge→Vercel
  failover, but `src/lib/api.ts` has a single `API_BASE` with no failover. Treat
  `server/*` (Node/Hono) as the source of truth; `supabase/functions/*` is legacy.
