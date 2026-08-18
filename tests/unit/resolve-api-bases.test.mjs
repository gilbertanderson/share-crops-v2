import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIMARY_API_BASE,
  VERCEL_FALLBACK_API_BASE,
  SAME_ORIGIN_API_BASE,
  resolveApiBasesForHost,
} from '../../scripts/domains.mjs';

describe('resolveApiBasesForHost', () => {
  it('on share-crops-v2 tries same-origin, then marketplace Vercel', () => {
    const bases = resolveApiBasesForHost('share-crops-v2.vercel.app');
    assert.deepEqual(bases, [
      SAME_ORIGIN_API_BASE,
      VERCEL_FALLBACK_API_BASE,
    ]);
  });

  it('on marketplace Vercel tries same-origin only', () => {
    const bases = resolveApiBasesForHost('share-crops-marketplace.vercel.app');
    assert.deepEqual(bases, [SAME_ORIGIN_API_BASE]);
  });

  it('on Netlify tries remote Vercel APIs only', () => {
    const bases = resolveApiBasesForHost('sharecropsmarketplace.netlify.app');
    assert.deepEqual(bases, [
      PRIMARY_API_BASE,
      VERCEL_FALLBACK_API_BASE,
    ]);
  });

  it('on Firebase Hosting tries remote Vercel APIs only', () => {
    const bases = resolveApiBasesForHost('share-crops-app.web.app');
    assert.deepEqual(bases, [
      PRIMARY_API_BASE,
      VERCEL_FALLBACK_API_BASE,
    ]);
  });

  it('on localhost tries same-origin, then configured fallback', () => {
    const bases = resolveApiBasesForHost('localhost', 'https://fallback.test/api/make-server-dd877831');
    assert.deepEqual(bases, [
      SAME_ORIGIN_API_BASE,
      'https://fallback.test/api/make-server-dd877831',
    ]);
  });

  it('on v2 preview deploys also tries marketplace Vercel', () => {
    const bases = resolveApiBasesForHost('share-crops-v2-git-main-user.vercel.app');
    assert.deepEqual(bases, [
      SAME_ORIGIN_API_BASE,
      VERCEL_FALLBACK_API_BASE,
    ]);
  });

  it('dedupes when fallback matches an earlier base', () => {
    const bases = resolveApiBasesForHost('custom.example.com', PRIMARY_API_BASE);
    assert.deepEqual(bases, [PRIMARY_API_BASE]);
  });
});
