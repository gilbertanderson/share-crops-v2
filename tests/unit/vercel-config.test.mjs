import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vercel = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));

describe('vercel.json', () => {
  it('uses Build Output API (no outputDirectory — api/index.js outside dist is ignored)', () => {
    assert.equal(vercel.outputDirectory, undefined);
    assert.match(vercel.buildCommand, /build-vercel-output\.mjs/);
    assert.match(vercel.buildCommand, /vite build/);
    assert.doesNotMatch(vercel.buildCommand, /build-api\.mjs/);
  });
});
