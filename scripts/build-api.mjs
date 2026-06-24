// Bundles the Vercel function into a single API file.
//
// Vercel's Node builder (via @vercel/nft) does not trace this plain Vite
// project's server tree reliably. esbuild resolves the local TypeScript imports
// and inlines the app code before Vercel packages it.
import { build } from 'esbuild';

await build({
  entryPoints: ['server/entry.ts'],
  outfile: 'api/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // esbuild keeps Node built-ins (node:*, fs, etc.) external automatically on
  // platform:node; app code and npm dependencies are inlined so the deployed
  // function has no package-resolution edge cases at runtime.
  logLevel: 'info',
  // ESM bundles that reference CJS globals (some transitive deps do) need these
  // shimmed at the top of the output.
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
});

console.log('✓ bundled server/entry.ts → api/index.js');
