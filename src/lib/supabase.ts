import { createClient } from '@supabase/supabase-js';
import { projectId, publicAnonKey } from '@/config/info';

const supabaseUrl = `https://${projectId}.supabase.co`;

export const supabase = createClient(supabaseUrl, publicAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    // We complete the OAuth redirect manually in AuthContext (so we can bridge
    // the resulting session into AuthManager), so don't auto-parse the URL.
    detectSessionInUrl: false,
    // PKCE returns `?code=...` on the callback, which we exchange explicitly.
    // (The default 'implicit' flow returns tokens in the URL hash instead.)
    flowType: 'pkce',
  },
  realtime: {
    params: { eventsPerSecond: 10 },
  },
});
