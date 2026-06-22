import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { AuthManager, API } from '@/lib/api';

// If we've landed on the OAuth callback (`?code=...`), exchange the code for a
// Supabase session and bridge its access token into AuthManager (the token the
// rest of the app authenticates API calls with). Returns once the URL has been
// cleaned so routing can proceed normally.
async function completeOAuthRedirect(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const oauthError = params.get('error_description') || params.get('error');
  if (!code && !oauthError) return;

  try {
    if (code) {
      const { supabase } = await import('@/lib/supabase');
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      const token = data.session?.access_token;
      if (token) {
        AuthManager.setToken(token);
        AuthManager.resetCommunitySelection();
      }
    } else if (oauthError) {
      console.error('OAuth sign-in failed:', oauthError);
    }
  } catch (e) {
    console.error('OAuth callback exchange failed:', e);
  } finally {
    // Strip the code/error params so a refresh doesn't re-trigger the exchange.
    window.history.replaceState({}, '', '/');
  }
}

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

interface AuthState {
  isAuthenticated: boolean;
  hasCompletedSetup: boolean;
  communityCount: number;
  isAdmin: boolean;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  refreshAuth: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    hasCompletedSetup: false,
    communityCount: 0,
    isAdmin: false,
    loading: true,
  });

  const refreshAuth = useCallback(async () => {
    // Finish an in-progress OAuth login before reading auth state.
    await completeOAuthRedirect();

    const authenticated = AuthManager.isAuthenticated();
    if (!authenticated) {
      setState({ isAuthenticated: false, hasCompletedSetup: false, communityCount: 0, isAdmin: false, loading: false });
      return;
    }
    try {
      const { user } = await API.getMe();
      const communitiesData = await API.getMyCommunities();
      const communityCount = communitiesData.communities?.length ?? 0;
      setState({
        isAuthenticated: true,
        hasCompletedSetup: communityCount > 0,
        communityCount,
        isAdmin: user?.role === 'admin',
        loading: false,
      });
    } catch {
      AuthManager.clearToken();
      setState({ isAuthenticated: false, hasCompletedSetup: false, communityCount: 0, isAdmin: false, loading: false });
    }
  }, []);

  const logout = useCallback(() => {
    AuthManager.clearToken();
    setState({ isAuthenticated: false, hasCompletedSetup: false, communityCount: 0, isAdmin: false, loading: false });
  }, []);

  // Inactivity auto-logout: reset timer on user activity; logout after 30 min idle
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!state.isAuthenticated) return;

    const resetTimer = () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      inactivityTimer.current = setTimeout(() => {
        logout();
      }, INACTIVITY_TIMEOUT_MS);
    };

    const events = ['mousemove', 'keydown', 'touchstart', 'pointerdown', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [state.isAuthenticated, logout]);

  useEffect(() => {
    refreshAuth();
  }, [refreshAuth]);

  return (
    <AuthContext.Provider value={{ ...state, refreshAuth, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
