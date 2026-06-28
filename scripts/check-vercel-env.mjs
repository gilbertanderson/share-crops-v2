const required = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
  'FIREBASE_PROJECT_ID',
];

const missing = required.filter((key) => !process.env[key]?.trim());

if (missing.length) {
  console.error('Missing required Vercel environment variables:');
  for (const key of missing) console.error(`- ${key}`);
  console.error('\nAdd them in Vercel Project Settings -> Environment Variables, then redeploy.');
  process.exit(1);
}

const clientProject = process.env.VITE_FIREBASE_PROJECT_ID?.trim();
const serverProject = process.env.FIREBASE_PROJECT_ID?.trim();
if (clientProject && serverProject && clientProject !== serverProject) {
  console.error(
    `VITE_FIREBASE_PROJECT_ID (${clientProject}) must match FIREBASE_PROJECT_ID (${serverProject}) for Google sign-in tokens to verify.`,
  );
  process.exit(1);
}

const authDomain = process.env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
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
