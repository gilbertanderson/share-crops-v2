import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIMARY_API_BASE,
  VERCEL_FALLBACK_API_BASE,
  SUPABASE_EDGE_API_BASE,
  SAME_ORIGIN_API_BASE,
  resolveApiBasesForHost,
} from '../../scripts/domains.mjs';

describe('resolveApiBasesForHost', () => {
  it('on share-crops-v2 tries same-origin, marketplace Vercel, then Supabase Edge', () => {
    const bases = resolveApiBasesForHost('share-crops-v2.vercel.app');
    assert.deepEqual(bases, [
      SAME_ORIGIN_API_BASE,
      VERCEL_FALLBACK_API_BASE,
      SUPABASE_EDGE_API_BASE,
    ]);
  });

  it('on marketplace Vercel tries same-origin then Supabase Edge only', () => {
    const bases = resolveApiBasesForHost('share-crops-marketplace.vercel.app');
    assert.deepEqual(bases, [SAME_ORIGIN_API_BASE, SUPABASE_EDGE_API_BASE]);
  });

  it('on Netlify tries remote Vercel APIs then Supabase Edge', () => {
    const bases = resolveApiBasesForHost('sharecropsmarketplace.netlify.app');
    assert.deepEqual(bases, [
      PRIMARY_API_BASE,
      VERCEL_FALLBACK_API_BASE,
      SUPABASE_EDGE_API_BASE,
    ]);
  });

  it('on Netlify preview deploys does not route CRUD to production APIs', () => {
    const bases = resolveApiBasesForHost('deploy-preview-99--sharecropsmarketplace.netlify.app');
    assert.deepEqual(bases, [SAME_ORIGIN_API_BASE]);
  });

  it('on Firebase Hosting tries remote Vercel APIs then Supabase Edge', () => {
    const bases = resolveApiBasesForHost('share-crops-app.web.app');
    assert.deepEqual(bases, [
      PRIMARY_API_BASE,
      VERCEL_FALLBACK_API_BASE,
      SUPABASE_EDGE_API_BASE,
    ]);
  });

  it('on localhost tries same-origin, configured fallback, then Supabase Edge', () => {
    const bases = resolveApiBasesForHost('localhost', 'https://fallback.test/api/make-server-dd877831');
    assert.deepEqual(bases, [
      SAME_ORIGIN_API_BASE,
      'https://fallback.test/api/make-server-dd877831',
      SUPABASE_EDGE_API_BASE,
    ]);
  });

  it('on v2 preview deploys also tries marketplace Vercel before Supabase Edge', () => {
    const bases = resolveApiBasesForHost('share-crops-v2-git-main-user.vercel.app');
    assert.deepEqual(bases, [
      SAME_ORIGIN_API_BASE,
      VERCEL_FALLBACK_API_BASE,
      SUPABASE_EDGE_API_BASE,
    ]);
  });

  it('dedupes when fallback matches an earlier base', () => {
    const bases = resolveApiBasesForHost('custom.example.com', PRIMARY_API_BASE);
    assert.deepEqual(bases, [PRIMARY_API_BASE, SUPABASE_EDGE_API_BASE]);
  });
});
