import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vercel = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

describe('vercel.json', () => {
  it('bundles the API via vite closeBundle (no duplicate build-api in buildCommand)', () => {
    assert.match(vercel.buildCommand, /check-vercel-env\.mjs/);
    assert.match(vercel.buildCommand, /vite build/);
    assert.doesNotMatch(vercel.buildCommand, /build-api\.mjs/);
  });

  it('configures the /api function with extra memory and duration', () => {
    assert.equal(vercel.functions?.['api/index.js']?.memory, 1024);
    assert.equal(vercel.functions?.['api/index.js']?.maxDuration, 60);
  });
});
