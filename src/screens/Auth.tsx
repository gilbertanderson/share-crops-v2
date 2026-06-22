import React, { useState } from 'react';
import { API, AuthManager } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/atoms/Toast';
import { validateEmail, validatePassword, LoginAttemptTracker } from '@/lib/security';
import { Tomato } from '@/components/atoms/Tomato';

type Mode = 'login' | 'signup';

export default function Auth() {
  const { refreshAuth } = useAuth();
  const { showToast } = useToast();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!validateEmail(email)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (mode === 'login' && LoginAttemptTracker.isLockedOut(email)) {
      setError(`Too many attempts. Try again in ${LoginAttemptTracker.getRetryAfterSeconds(email)}s.`);
      return;
    }
    if (mode === 'signup') {
      if (!name.trim()) {
        setError('Please enter your name.');
        return;
      }
      const pw = validatePassword(password);
      if (!pw.valid) {
        setError(pw.errors[0]);
        return;
      }
    }

    setBusy(true);
    try {
      if (mode === 'signup') {
        const { accessToken } = await API.signup(email, password, name.trim());
        if (accessToken) AuthManager.setToken(accessToken);
      } else {
        await API.login(email, password);
        LoginAttemptTracker.clear(email);
      }
      await refreshAuth();
      // App-level routing redirects to /community-setup or /marketplace.
    } catch (err) {
      if (mode === 'login') LoginAttemptTracker.record(email);
      setError((err as Error).message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const oauth = async () => {
    try {
      await API.signInWithOAuth('google');
    } catch (err) {
      showToast((err as Error).message || 'Google sign-in failed');
    }
  };

  const forgotPassword = async () => {
    if (!validateEmail(email)) {
      setError('Enter your email above first, then tap reset.');
      return;
    }
    try {
      await API.resetPassword(email);
      showToast('Password reset email sent');
    } catch (err) {
      showToast((err as Error).message || 'Could not send reset email');
    }
  };

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div className="auth-logo"><Tomato filled size={52} /></div>
          <h1 className="serif">Share Crops</h1>
          <p>Trade what you grow with your community.</p>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <div className="auth-fields">
          {mode === 'signup' && (
            <div className="auth-field">
              <label className="field-label">Name</label>
              <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
          )}
          <div className="auth-field">
            <label className="field-label">Email</label>
            <input className="input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="auth-field">
            <label className="field-label">Password</label>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Log In' : 'Create Account'}
          </button>
        </div>

        {mode === 'login' && (
          <div style={{ textAlign: 'center', marginTop: 10 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={forgotPassword}>
              Forgot password?
            </button>
          </div>
        )}

        <div className="divider">OR</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button type="button" className="btn btn-outline btn-block" onClick={oauth}>
            Continue with Google
          </button>
        </div>

        <div className="auth-switch">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); }}>
            {mode === 'login' ? 'Sign up' : 'Log in'}
          </button>
        </div>
      </form>
    </div>
  );
}
