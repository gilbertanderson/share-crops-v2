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

### Local Firebase Auth without real credentials (Auth Emulator)
Real signup/login can be exercised locally with the **Firebase Auth Emulator**
— no Firebase project login or secrets required:
- Start it: `npx -y firebase-tools@latest emulators:start --only auth --project demo-share-crops`
  (Auth on `127.0.0.1:9099`, UI on `4000`; config lives in `firebase.json`
  `emulators`). The Auth emulator is Node-based — no Java needed.
- `src/lib/firebase.ts` connects to it only when
  `VITE_FIREBASE_AUTH_EMULATOR_HOST` is set (already in `.env.local` as
  `127.0.0.1:9099`); it is inert in production. Restart `vite` after changing
  `.env.local`.
- With the emulator running, all 3 `tests/auth-firebase.spec.ts` specs pass,
  including the compliant-signup → "Check your email" flow that otherwise needs
  real Firebase.
- Drive it directly via the Identity Toolkit REST API, e.g.
  `POST http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=<any>`
  with `{email,password,returnSecureToken:true}`. Emulator-issued ID tokens have
  `iss/aud = demo-share-crops` and `email_verified:false` for new email/password
  users — which is why the app holds them at the verification screen.

### MCP servers
The repo declares its MCP servers in `.mcp.json` (project-scoped, version
controlled):
- **Supabase** — `https://mcp.supabase.com/mcp?...` (read-only). Already
  authorized in the Cursor Cloud environment, so its tools work out of the box.
- **Vercel** — `https://mcp.vercel.com`. This is the official, **OAuth-only**
  remote server; there is no static token / header auth. On first connection
  Cursor shows a **"Needs login"** prompt that must be authorized interactively
  in the **Cursor desktop IDE**. An autonomous cloud agent cannot complete this
  OAuth handshake, which is why the Vercel server can surface as `error` /
  `Needs login` in cloud runs. To make it usable:
  1. In the Cursor desktop IDE, open Settings → MCP and authorize **Vercel**
     (log in with your Vercel account). This persists the OAuth grant.
  2. For Cloud Agents specifically, ensure the cloud-agent **Network Access**
     allowlist includes `mcp.vercel.com` (cloud-agent shell egress is otherwise
     blocked). Configure this under Cloud Agents settings.
  Cloud agents cannot perform step 1 themselves — it requires a human in the
  desktop IDE.

### Testing
- E2E: `npx playwright test` (Playwright auto-starts Vite on port 4321). Browser
 install: `npx playwright install chromium` (Chromium only; that's all the
 config uses). Uses system Chrome when bundled Chromium is unavailable (`channel: 'chrome'`).
- `tests/ai-draft.spec.ts` covers ✨ Draft with AI (Firebase Auth Emulator + mocked API).
  Starts the Auth Emulator via `playwright.global-setup.ts`.
- `tests/auth-firebase.spec.ts` "signup with a compliant password…" creates a
  user via Firebase Auth — point it at the Auth Emulator (above) to run it
  without real credentials/network.
- Full end-to-end marketplace flow (browse listings, offers, messaging) still
  needs the running Hono API + a Supabase project with
  `supabase/migrations/*.sql` applied + the server env (`SUPABASE_*`,
  `FIREBASE_SERVICE_ACCOUNT`, etc.). The Auth Emulator only covers auth.
