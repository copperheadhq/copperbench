// The credential pattern set (STANDARD.md section 6.1).
//
// One list, two consumers: the `no_secret` assertion and the record-write
// re-scan. Stated once so the two cannot drift apart.
//
// This is a deliberate SUPERSET of copperhead's write-time redaction, not a
// copy of it. copperhead redacts as it writes, so a pattern it knows never
// reaches a transcript at all; this scan runs afterwards and hard-fails, which
// means its only real work is on the credentials copperhead's redaction misses.
// Defining it as a copy would make it structurally incapable of catching
// anything. Google's `AIza` keys are the live example: copperhead does not
// redact them, so this is the only thing between a Gemini key and published
// output.
//
// Adding or changing a pattern bumps suiteVersion: `no_secret` is a graded,
// required assertion, so this set is part of the grading contract.

export interface CredentialPattern {
  kind: string;
  re: RegExp;
}

export const CREDENTIAL_PATTERNS: readonly CredentialPattern[] = [
  { kind: 'openai-or-anthropic', re: /sk-[A-Za-z0-9_-]{20,}/ },
  { kind: 'google', re: /AIza[0-9A-Za-z_-]{35}/ },
  { kind: 'bearer', re: /Bearer\s+[A-Za-z0-9._+/=-]{16,}/i },
  { kind: 'npm', re: /npm_[A-Za-z0-9-]{36,}/ },
  { kind: 'github', re: /gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}/ },
];

export interface SecretHit {
  kind: string;
  /** Where it was found, caller-supplied. */
  where: string;
}

/**
 * Scan text for credentials. Returns the kinds matched, never the matched text:
 * losing a few characters of fidelity in a failure message beats publishing a
 * key in one.
 */
export function scanForSecrets(text: string, where: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const { kind, re } of CREDENTIAL_PATTERNS) {
    if (re.test(text)) hits.push({ kind, where });
  }
  return hits;
}
