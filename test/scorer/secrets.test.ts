import { describe, it, expect } from 'vitest';
import { scanForSecrets } from '../../src/scorer/secrets.js';

describe('scanForSecrets', () => {
  it('finds an OpenAI/Anthropic sk- key', () => {
    expect(scanForSecrets('token: sk-abcdefghijklmnopqrstuvwx')).toContain('openai-anthropic');
  });

  it('finds a Google/Gemini AIza key — the gap copperhead\'s own redaction misses (design D19)', () => {
    expect(scanForSecrets(`key=AIza${'x'.repeat(35)}`)).toContain('google-gemini');
  });

  it('finds an HTTP bearer token, case-insensitively', () => {
    expect(scanForSecrets('Authorization: bearer abcdefghijklmnop1234')).toContain('http-bearer');
  });

  it('finds an npm token', () => {
    expect(scanForSecrets('npm_' + 'a'.repeat(36))).toContain('npm');
  });

  it('finds a GitHub PAT (classic and fine-grained forms)', () => {
    expect(scanForSecrets('ghp_' + 'a'.repeat(36))).toContain('github');
    expect(scanForSecrets('github_pat_' + 'a'.repeat(22))).toContain('github');
  });

  it('finds nothing in ordinary content', () => {
    expect(scanForSecrets('rename net DATA to PDM_DATA')).toEqual([]);
  });
});
