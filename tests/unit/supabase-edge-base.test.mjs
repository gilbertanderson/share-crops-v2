import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSupabaseEdgeBase } from '../../scripts/domains.mjs';

describe('isSupabaseEdgeBase', () => {
  it('detects Supabase Edge function URLs', () => {
    assert.equal(
      isSupabaseEdgeBase('https://xwjvtpzpufhuybylnwzx.supabase.co/functions/v1/make-server-dd877831'),
      true,
    );
    assert.equal(isSupabaseEdgeBase('/api/make-server-dd877831'), false);
    assert.equal(
      isSupabaseEdgeBase('https://share-crops-v2.vercel.app/api/make-server-dd877831'),
      false,
    );
  });
});
