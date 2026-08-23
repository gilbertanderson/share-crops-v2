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

  it('decodes Firebase *_B64 env before generating workers or building the SPA', () => {
    const decode = vercel.buildCommand.indexOf('decode-firebase-env.mjs');
    const generateSw = vercel.buildCommand.indexOf('generate-sw.mjs');
    const checkEnv = vercel.buildCommand.indexOf('check-vercel-env.mjs');
    const viteBuild = vercel.buildCommand.indexOf('vite build');

    assert.ok(decode >= 0);
    assert.ok(generateSw > decode);
    assert.ok(checkEnv > decode);
    assert.ok(viteBuild > decode);
  });
});
