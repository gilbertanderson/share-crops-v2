# AGENTS.md

## Cursor Cloud specific instructions

### What this is
Share Crops v2 — a single npm package (not a monorepo): a React 18 + Vite 6 SPA
frontend plus one Hono API backend (`server/`, bundled to `api/index.js` for
Vercel). Auth is Firebase (browser), data/storage is Supabase (server-side).
Standard commands live in `package.json` and `README.md`; don't duplicate them.

### Services
- **Frontend SPA (Vite dev server)** — `npm run dev` → http://localhost:5173.
  This is the main thing you run locally. Build with `npm run build`
  (`tsc --noEmit` + `vite build`). There is no lint script and no unit tests.
- **Hono API backend** — there is no local "start API" script. It builds via
  `node scripts/build-api.mjs` → `api/index.js` and runs as a Vercel function
  (or `vercel dev`). `server/app.ts` throws at startup unless `ADMIN_EMAIL`,
  `APP_ID`, `STORAGE_BUCKET_NAME`, `KV_TABLE_NAME`, and `CORS_ORIGINS` are set,
  so running the real backend locally requires the full server env + a real
  Supabase project.

### Non-obvious gotchas
- **The app crashes to a blank page if `VITE_FIREBASE_*` are empty.** `getAuth()`
  in `src/lib/firebase.ts` throws `auth/invalid-api-key` at module load with an
  empty `apiKey`, taking down the whole SPA (even the login screen). Use
  well-formed dummy `VITE_FIREBASE_*` values in `.env.local` to let the SPA boot
  for UI work; real values are only needed for actual Firebase auth.
- **Do NOT set `VITE_FALLBACK_API_URL=` (empty) in `.env.local`.** Vite's
  `.env.local` overrides the value Playwright's `webServer` injects
  (`https://fallback.test/...`), which breaks the mocked specs (they hit
  same-origin `/api/...` instead of the intercepted fallback host). Leave it
  unset. Leaving it unset means the app calls same-origin `/api/make-server-dd877831`.
- **Auth gating is fully Firebase-driven** (`AuthContext` → `onAuthChange` +
  `getIdToken()`). The legacy `seedAuth` localStorage `sharecrops_token` used by
  several Playwright specs is no longer honored by the app, so the
  `marketplace`, `_cap`, and `failover` specs currently fail regardless of
  environment — they predate the Firebase-auth refactor. The `smoke` specs and
  the two client-side `auth-firebase` specs (route gating + weak-password block)
  pass with dummy Firebase config. The `screenshots` specs have no assertions
  (they only capture images), so they "pass" trivially.

### Testing
- E2E: `npx playwright test` (Playwright auto-starts Vite on port 4321). Browser
  install: `npx playwright install chromium` (Chromium only; that's all the
  config uses).
- Specs needing **real** Firebase + network (will fail without credentials):
  `tests/auth-firebase.spec.ts` "signup with a compliant password…" actually
  creates a real Firebase user and sends a verification email.
- Full end-to-end marketplace flow (browse listings, offers, messaging) needs
  real Firebase Auth + a Supabase project with `supabase/migrations/*.sql`
  applied + the full server env. Without those secrets, only client-side flows
  (login/signup UI, validation, route gating) can be exercised locally.
