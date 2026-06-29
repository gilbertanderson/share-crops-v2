const clientRequired = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'FIREBASE_PROJECT_ID',
];

// Server API — missing any of these crashes api/index.js at cold start and
// breaks /auth/me with a generic "Could not load your profile" in the browser.
const serverRequired = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ADMIN_EMAIL',
  'APP_ID',
  'STORAGE_BUCKET_NAME',
  'KV_TABLE_NAME',
  'CORS_ORIGINS',
];

function envValue(key) {
  const direct = process.env[key]?.trim();
  if (direct) return direct;
  const b64 = process.env[`${key}_B64`]?.trim();
  if (!b64) return '';
  return Buffer.from(b64, 'base64').toString('utf8').trim();
}

const vercelEnv = process.env.VERCEL_ENV || 'unknown';
const isProductionBuild = vercelEnv === 'production';

const missingClient = clientRequired.filter((key) => !envValue(key));
const missingServer = serverRequired.filter((key) => !envValue(key));

if (missingClient.length) {
  console.error(`Missing required Vercel environment variables (VERCEL_ENV=${vercelEnv}):`);
  for (const key of missingClient) console.error(`- ${key}`);
  console.error(
    '\nAdd them in Vercel → Project Settings → Environment Variables.',
  );
  console.error(
    'Scope each to Production AND Preview (missing Preview vars fails PR deploys).',
  );
  console.error(
    'Apply the same vars on BOTH projects: share-crops-v2 and share-crops-marketplace.',
  );
  process.exit(1);
}

if (missingServer.length) {
  const lines = missingServer.map((key) => `- ${key}`).join('\n');
  if (isProductionBuild) {
    console.error(`Missing required server API environment variables (VERCEL_ENV=${vercelEnv}):`);
    console.error(lines);
    console.error(
      '\nWithout these, /api returns 502 at runtime. Add them for Production (and Preview if you test API on PR deploys).',
    );
    process.exit(1);
  }
  console.warn(`⚠ Preview build: server API env vars are missing (VERCEL_ENV=${vercelEnv}):`);
  console.warn(lines);
  console.warn(
    '\nThe SPA will build, but /api on this preview will 502 until you scope these to Preview in Vercel.',
  );
}

const clientProject = envValue('VITE_FIREBASE_PROJECT_ID');
const serverProject = envValue('FIREBASE_PROJECT_ID');
if (clientProject && serverProject && clientProject !== serverProject) {
  console.error(
    `VITE_FIREBASE_PROJECT_ID (${clientProject}) must match FIREBASE_PROJECT_ID (${serverProject}) for Google sign-in tokens to verify.`,
  );
  process.exit(1);
}

const authDomain = envValue('VITE_FIREBASE_AUTH_DOMAIN');
if (authDomain && !/\.(firebaseapp\.com|web\.app)$/.test(authDomain)) {
  console.error(
    `VITE_FIREBASE_AUTH_DOMAIN must be <project>.firebaseapp.com, not your hosting URL.`,
  );
  console.error(`  Got: ${authDomain}`);
  console.error('  Add your Vercel/custom hostname to Firebase Authorized domains instead.');
  process.exit(1);
}

console.log('✓ required Vercel environment variables are present');

if (!process.env.ANTHROPIC_API_KEY?.trim()) {
  console.warn('⚠ ANTHROPIC_API_KEY is not set — the ✨ Draft with AI button will return 503 until you add it and redeploy.');
}

if (!process.env.VITE_FIREBASE_VAPID_KEY?.trim()) {
  console.warn('⚠ VITE_FIREBASE_VAPID_KEY is not set — Profile → Enable notifications will fail until you add it and redeploy.');
}

const blobsSite = process.env.NETLIFY_BLOBS_SITE_ID?.trim();
const blobsToken = process.env.NETLIFY_BLOBS_TOKEN?.trim();
if (blobsSite && blobsToken) {
  console.log('✓ Netlify Blobs image storage is configured (stable /images/ URLs)');
} else if (blobsSite || blobsToken) {
  console.warn(
    '⚠ NETLIFY_BLOBS_SITE_ID and NETLIFY_BLOBS_TOKEN must both be set — uploads still use expiring Supabase signed URLs.',
  );
} else {
  console.warn(
    '⚠ Netlify Blobs not configured — /upload returns 1-year Supabase signed URLs that expire on stored listings. See DEPLOY.md §5.',
  );
}
