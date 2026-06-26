import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { User } from 'firebase/auth';
import { API, AuthManager, setUnauthorizedHandler } from '@/lib/api';
import { onAuthChange, logout as firebaseLogout } from '@/lib/firebaseAuth';

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

interface AuthState {
  isAuthenticated: boolean;
  // Signed into Firebase but the email isn't verified yet. The backend rejects
  // unverified tokens, so these users are held at a "verify your email" screen
  // rather than entering the app.
  needsEmailVerification: boolean;
  hasCompletedSetup: boolean;
  communityCount: number;
  isAdmin: boolean;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  refreshAuth: () => Promise<void>;
  logout: () => void;
}

const UNAUTH: AuthState = {
  isAuthenticated: false,
  needsEmailVerification: false,
  hasCompletedSetup: false,
  communityCount: 0,
  isAdmin: false,
  loading: false,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ ...UNAUTH, loading: true });

  // The current Firebase user, kept in a ref so refreshAuth() can re-resolve the
  // app profile without waiting for another onAuthChange event.
  const currentUser = useRef<User | null>(null);

  // Resolve app-level auth state for a given Firebase user: signed out →
  // unauthenticated; unverified email → held for verification; verified → load
  // the profile + communities from the backend (token attached by API.request).
  const applyUser = useCallback(async (user: User | null) => {
    if (!user) {
      setState({ ...UNAUTH });
      return;
    }
    if (!user.emailVerified) {
      setState({ ...UNAUTH, needsEmailVerification: true });
      return;
    }
    try {
      const { user: profile } = await API.getMe();
      const communitiesData = await API.getMyCommunities();
      const communityCount = communitiesData.communities?.length ?? 0;
      setState({
        isAuthenticated: true,
        needsEmailVerification: false,
        hasCompletedSetup: communityCount > 0,
        communityCount,
        isAdmin: profile?.role === 'admin',
        loading: false,
      });
    } catch {
      setState({ ...UNAUTH });
    }
  }, []);

  const refreshAuth = useCallback(async () => {
    await applyUser(currentUser.current);
  }, [applyUser]);

  const logout = useCallback(() => {
    // Signing out fires onAuthChange(null), which resets state via applyUser.
    firebaseLogout();
    AuthManager.clearToken(); // clear cached profile + community selection
  }, []);

  // Subscribe to Firebase auth state for the provider's lifetime.
  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      currentUser.current = user;
      applyUser(user);
    });
    return unsubscribe;
  }, [applyUser]);

  // Any 401 from the API means the session is no longer valid server-side
  // (expired/rejected token); sign out so the app falls back to the login
  // screen instead of repeatedly issuing failing requests.
  useEffect(() => {
    setUnauthorizedHandler(() => logout());
    return () => setUnauthorizedHandler(null);
  }, [logout]);

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
