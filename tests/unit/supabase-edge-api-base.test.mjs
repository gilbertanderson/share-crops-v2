import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SUPABASE_EDGE_API_BASE } from '../../scripts/domains.mjs';

describe('Supabase Edge API base', () => {
  it('does not double the function slug (404 on /auth/me failover)', () => {
    assert.equal(
      SUPABASE_EDGE_API_BASE,
      'https://xwjvtpzpufhuybylnwzx.supabase.co/functions/v1/make-server-dd877831',
    );
    assert.doesNotMatch(SUPABASE_EDGE_API_BASE, /make-server-dd877831\/make-server-dd877831/);
  });

  it('resolves /auth/me to the path Supabase maps onto Hono routes', () => {
    const authMe = `${SUPABASE_EDGE_API_BASE}/auth/me`;
    assert.equal(
      authMe,
      'https://xwjvtpzpufhuybylnwzx.supabase.co/functions/v1/make-server-dd877831/auth/me',
    );
  });
});
