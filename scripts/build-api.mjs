// Bundles the Vercel function into a single self-contained file.
//
// The function entry (server/entry.ts) imports the shared Hono backend from
// supabase/functions/_shared, which uses Deno-style `.ts`-extension imports and
// `@ts-nocheck`. Vercel's Node builder (via @vercel/nft) can't trace those, so a
// plain `api/index.ts` ships without its dependency and crashes with
// ERR_MODULE_NOT_FOUND at runtime. esbuild resolves `.ts` imports natively and
// inlines every local + npm dependency, leaving nothing to trace at runtime.
import { build } from 'esbuild';

await build({
  entryPoints: ['server/entry.ts'],
  outfile: 'api/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // esbuild keeps Node built-ins (node:*, fs, etc.) external automatically on
  // platform:node; everything else (hono, @supabase/supabase-js, shared code)
  // is inlined so the deployed function has zero unresolved imports.
  logLevel: 'info',
  // ESM bundles that reference CJS globals (some transitive deps do) need these
  // shimmed at the top of the output.
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
});

console.log('✓ bundled server/entry.ts → api/index.js');
