#!/usr/bin/env node
/**
 * Quick Netlify readiness check for Cloud Agents / local dev.
 * Does NOT print secret values.
 */
const vars = [
  'NETLIFY_AUTH_TOKEN',
  'NETLIFY_PERSONAL_ACCESS_TOKEN',
  'NETLIFY_BLOBS_TOKEN',
  'NETLIFY_BLOBS_SITE_ID',
];

let ok = true;

console.log('Netlify setup check\n');

for (const name of vars) {
  const set = Boolean(process.env[name]);
  console.log(`  ${name}: ${set ? 'set' : 'MISSING'}`);
  if (!set && (name === 'NETLIFY_AUTH_TOKEN' || name === 'NETLIFY_PERSONAL_ACCESS_TOKEN')) {
    // CLI and MCP need at least one token; Blobs needs its own pair for the app.
  }
}

console.log('\nAPI reachability (api.netlify.com):');
try {
  const res = await fetch('https://api.netlify.com/api/v1/sites', {
    method: 'GET',
    signal: AbortSignal.timeout(15_000),
  });
  console.log(`  HTTP ${res.status} (egress OK; auth may still be required)`);
} catch (e) {
  ok = false;
  const msg = e instanceof Error ? e.message : String(e);
  console.log(`  FAILED — ${msg}`);
  if (/ECONNRESET|fetch failed|terminated/i.test(msg)) {
    console.log('  → Add api.netlify.com to Cloud Agents → Network Access, then restart the agent.');
  }
}

const hasCliToken = Boolean(process.env.NETLIFY_AUTH_TOKEN);
const hasMcpToken = Boolean(process.env.NETLIFY_PERSONAL_ACCESS_TOKEN);
const hasBlobs = Boolean(process.env.NETLIFY_BLOBS_TOKEN && process.env.NETLIFY_BLOBS_SITE_ID);

console.log('\nCapabilities:');
console.log(`  netlify CLI (NETLIFY_AUTH_TOKEN): ${hasCliToken ? 'ready' : 'needs token'}`);
console.log(`  Netlify MCP (NETLIFY_PERSONAL_ACCESS_TOKEN): ${hasMcpToken ? 'ready' : 'needs token'}`);
console.log(`  App Blobs path: ${hasBlobs ? 'ready' : 'needs NETLIFY_BLOBS_SITE_ID + NETLIFY_BLOBS_TOKEN'}`);

if (!ok || (!hasCliToken && !hasMcpToken)) {
  console.log('\nIf you just added secrets or allowlist rules, restart the Cloud Agent (Cursor docs).');
  console.log('For stdio MCP on Cloud Agents, set the token in the Cloud Agent MCP portal env block');
  console.log('if ${NETLIFY_PERSONAL_ACCESS_TOKEN} in .mcp.json does not resolve.');
  process.exit(1);
}

console.log('\nAll checks passed.');
process.exit(0);
