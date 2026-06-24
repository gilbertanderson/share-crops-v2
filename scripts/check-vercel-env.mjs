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

console.log('✓ required Vercel environment variables are present');
