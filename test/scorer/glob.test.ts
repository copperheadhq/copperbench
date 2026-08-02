import { describe, it, expect } from 'vitest';
import { globToRegExp } from '../../src/scorer/glob.js';

describe('globToRegExp', () => {
  it('matches an exact path with no wildcards', () => {
    const re = globToRegExp('hardware/microphone-board.kicad_sch');
    expect(re.test('hardware/microphone-board.kicad_sch')).toBe(true);
    expect(re.test('hardware/other-board.kicad_sch')).toBe(false);
  });

  it('* matches within one path segment only', () => {
    const re = globToRegExp('docs/*.md');
    expect(re.test('docs/PINOUT.md')).toBe(true);
    expect(re.test('docs/sub/PINOUT.md')).toBe(false);
  });

  it('** matches across path segments', () => {
    const re = globToRegExp('.copperhead/**');
    expect(re.test('.copperhead/config.json')).toBe(true);
    expect(re.test('.copperhead/runs/2026-08-01T00-00-00-000Z/transcript.jsonl')).toBe(true);
  });

  it('escapes a literal "." so it does not match an arbitrary character', () => {
    const re = globToRegExp('hardware/board.kicad_sch');
    expect(re.test('hardware/board.kicad_sch')).toBe(true);
    // If "." were left as a regex metachar, this would also match.
    expect(re.test('hardware/boardXkicad_sch')).toBe(false);
  });
});
