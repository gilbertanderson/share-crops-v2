import React, { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  signUpWithEmail,
  signInWithEmail,
  signInWithGoogle,
  onAuthChange,
  getIdToken,
  logout,
} from '@/lib/firebaseAuth';

// Isolated proof-of-life for Firebase Auth against the real `share-crops-app`
// project. Reachable at /firebase-demo. Deliberately does NOT touch the
// Supabase-backed AuthContext / API layer — it only exercises the Firebase SDK.
export default function FirebaseAuthDemo() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => onAuthChange((u) => { setUser(u); setReady(true); }), []);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      setError(err.code ? `${err.code} — ${err.message}` : String(err.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const box: React.CSSProperties = {
    maxWidth: 420, margin: '40px auto', padding: 24, fontFamily: 'system-ui, sans-serif',
    border: '1px solid #e3e3e3', borderRadius: 12, background: '#fff',
  };
  const input: React.CSSProperties = {
    width: '100%', padding: '10px 12px', margin: '6px 0', boxSizing: 'border-box',
    border: '1px solid #ccc', borderRadius: 8, fontSize: 15,
  };
  const btn: React.CSSProperties = {
    padding: '10px 14px', borderRadius: 8, border: '1px solid #d23', background: '#e8482e',
    color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: 14,
  };
  const btnAlt: React.CSSProperties = { ...btn, background: '#fff', color: '#333', borderColor: '#ccc' };

  if (!ready) return <div style={box}>Loading Firebase…</div>;

  return (
    <div style={box}>
      <h2 style={{ marginTop: 0 }}>🍅 Firebase Auth Demo</h2>
      <p style={{ color: '#666', fontSize: 13, marginTop: -6 }}>
        Project <code>share-crops-app</code> · isolated from the Supabase app.
      </p>

      {user ? (
        <>
          <div style={{ background: '#f6f6f6', borderRadius: 8, padding: 12, fontSize: 14 }}>
            <div><strong>Signed in ✅</strong></div>
            <div>uid: <code>{user.uid}</code></div>
            <div>email: {user.email ?? '—'}</div>
            <div>name: {user.displayName ?? '—'}</div>
            <div>providers: {user.providerData.map((p) => p.providerId).join(', ') || '—'}</div>
            <div>verified: {String(user.emailVerified)}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button style={btnAlt} disabled={busy}
              onClick={() => run(async () => setToken(await getIdToken()))}>
              Show ID token
            </button>
            <button style={btn} disabled={busy}
              onClick={() => run(async () => { await logout(); setToken(null); })}>
              Sign out
            </button>
          </div>
          {token && (
            <textarea readOnly value={token} style={{ ...input, height: 90, fontSize: 11 }} />
          )}
        </>
      ) : (
        <>
          <input style={input} type="email" placeholder="email" autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)} />
          <input style={input} type="password" placeholder="password (≥6 chars)" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button style={btn} disabled={busy}
              onClick={() => run(() => signInWithEmail(email, password))}>
              Sign in
            </button>
            <button style={btnAlt} disabled={busy}
              onClick={() => run(() => signUpWithEmail(email, password))}>
              Create account
            </button>
          </div>
          <button style={{ ...btnAlt, width: '100%', marginTop: 8 }} disabled={busy}
            onClick={() => run(() => signInWithGoogle())}>
            Continue with Google
          </button>
        </>
      )}

      {error && (
        <p style={{ color: '#c00', fontSize: 13, marginTop: 12, wordBreak: 'break-word' }}>
          {error}
        </p>
      )}
    </div>
  );
}
