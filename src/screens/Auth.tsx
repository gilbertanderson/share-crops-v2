import React, { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/atoms/Toast';
import { validateEmail, validatePassword, LoginAttemptTracker } from '@/lib/security';
import { TomatoMark } from '@/components/atoms/TomatoMark';
import {
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  friendlyAuthError,
  sendVerificationEmail,
  reloadCurrentUser,
  sendPasswordReset,
  currentUserEmail,
} from '@/lib/firebaseAuth';

type Mode = 'login' | 'signup';

export default function Auth() {
  const { refreshAuth, needsEmailVerification, logout, authError, clearAuthError } = useAuth();
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
    clearAuthError();

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
        // Creates the account, sets the display name, and sends a verification
        // email. AuthContext (via onAuthChange) then shows the verify screen.
        await signUpWithEmail(email, password, name.trim());
      } else {
        await signInWithEmail(email, password);
        LoginAttemptTracker.clear(email);
      }
      // onAuthChange drives AuthContext; refresh covers the already-verified case.
      await refreshAuth();
    } catch (err) {
      if (mode === 'login') LoginAttemptTracker.record(email);
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const oauth = async () => {
    setError(null);
    clearAuthError();
    setBusy(true);
    try {
      await signInWithGoogle();
      await refreshAuth();
    } catch (err) {
      showToast(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const forgotPassword = async () => {
    if (!validateEmail(email)) {
      setError('Enter your email above first, then tap reset.');
      return;
    }
    try {
      await sendPasswordReset(email);
      showToast('Password reset email sent');
    } catch (err) {
      showToast(friendlyAuthError(err));
    }
  };

  // Signed into Firebase but unverified → hold here until they confirm.
  if (needsEmailVerification) {
    return <VerifyEmail email={email || currentUserEmail() || 'your email'} onVerified={refreshAuth} onSignOut={logout} />;
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div className="auth-logo"><TomatoMark size={64} /></div>
          <h1 className="serif">Share Crops</h1>
          <p>Trade what you grow with your community.</p>
        </div>

        {error && <div className="auth-error">{error}</div>}
        {authError && <div className="auth-error">{authError}</div>}

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
          <button type="button" className="btn btn-outline btn-block" onClick={oauth} disabled={busy}>
            {busy ? 'Please wait…' : 'Continue with Google'}
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

function VerifyEmail({ email, onVerified, onSignOut }: { email: string; onVerified: () => Promise<void>; onSignOut: () => void }) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    try {
      const verified = await reloadCurrentUser();
      if (verified) {
        await onVerified();
      } else {
        showToast("Not verified yet — click the link in your email, then try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await sendVerificationEmail();
      showToast('Verification email sent');
    } catch (err) {
      showToast((err as Error)?.message || 'Could not resend email');
    }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo"><TomatoMark size={64} /></div>
          <h1 className="serif">Check your email</h1>
          <p>We sent a verification link to <strong>{email}</strong>. Click it to activate your account, then come back here.</p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <button type="button" className="btn btn-primary btn-block" onClick={check} disabled={busy}>
            {busy ? 'Checking…' : "I've verified my email"}
          </button>
          <button type="button" className="btn btn-outline btn-block" onClick={resend}>
            Resend verification email
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onSignOut}>
            Use a different account
          </button>
        </div>
      </div>
    </div>
  );
}
