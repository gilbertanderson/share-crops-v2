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
  // platform:node; app code and ordinary npm dependencies are inlined so the
  // deployed function has fewer runtime imports to trace.
  //
  // firebase-admin is the exception: it has native/gRPC deps and dynamic
  // requires that don't bundle cleanly. Leaving it external keeps the `import`
  // statements in the output, which Vercel's file tracer (@vercel/nft) follows
  // to include the package from node_modules at deploy time.
  external: ['firebase-admin', 'firebase-admin/*'],
  logLevel: 'info',
  // ESM bundles that reference CJS globals (some transitive deps do) need these
  // shimmed at the top of the output.
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
});

console.log('✓ bundled server/entry.ts → api/index.js');
