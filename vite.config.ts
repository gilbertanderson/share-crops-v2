import { defineConfig } from 'vite';
import path from 'path';
import { execFileSync } from 'node:child_process';
import react from '@vitejs/plugin-react';

const NETLIFY_PLACEHOLDER_FIREBASE = {
  VITE_FIREBASE_API_KEY: 'fake-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo-share-crops.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-share-crops',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo-share-crops.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  VITE_FIREBASE_APP_ID: '1:1234567890:web:abcdef',
};

function applyNetlifyPlaceholderFirebaseEnv() {
  const usePlaceholders =
    process.env.NETLIFY === 'true' && process.env.NETLIFY_INJECT_FIREBASE !== 'true';
  if (!usePlaceholders) return;
  for (const [key, value] of Object.entries(NETLIFY_PLACEHOLDER_FIREBASE)) {
    process.env[key] = value;
  }
}

applyNetlifyPlaceholderFirebaseEnv();

// Bundle the Vercel serverless function (api/index.js) as part of `vite build`.
// Vercel's project Build Command is `vite build`, which would otherwise skip
// scripts/build-api.mjs and leave no function — every /api/* request then falls
// through to the SPA (static index.html), so the backend silently 404/405s in
// prod. Running the bundler in closeBundle guarantees the function exists at
// deploy time regardless of which build command Vercel invokes.
function bundleApiFunction() {
  return {
    name: 'bundle-api-function',
    apply: 'build' as const,
    closeBundle() {
      // Netlify hosts the static SPA only — skip bundling api/index.js so server
      // secrets in the Netlify env are not embedded in build output for scanning.
      if (process.env.NETLIFY === 'true') return;
      execFileSync('node', ['scripts/build-api.mjs'], { stdio: 'inherit' });
    },
  };
}

export default defineConfig({
  plugins: [react(), bundleApiFunction()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
