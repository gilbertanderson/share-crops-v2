// Backend connection info. Defaults point at the SAME deployed Supabase
// project used by the original shareCropsApp, so this rebuild talks to the
// existing Edge Functions / database out of the box. Override via .env.local.

export const projectId =
  import.meta.env.VITE_SUPABASE_PROJECT_ID || 'xwjvtpzpufhuybylnwzx';

export const publicAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3anZ0cHpwdWZodXlieWxud3p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5OTE2OTQsImV4cCI6MjA5MjU2NzY5NH0.aldPfV9K4VZaJKQJgMTx27JRHqIKesAedRyBt8LPIxQ';
