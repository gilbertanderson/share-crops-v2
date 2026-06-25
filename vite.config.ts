import { defineConfig } from 'vite';
import path from 'path';
import { execFileSync } from 'node:child_process';
import react from '@vitejs/plugin-react';

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
