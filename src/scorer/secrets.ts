/**
 * STANDARD.md section 6.1: the credential pattern set shared by the
 * `no_secret` assertion and the record-write re-scan (tasks.md 5.1). This is
 * the single place both read, so the two cannot drift apart (STANDARD.md is
 * explicit about that risk).
 *
 * Deliberately a superset of copperhead's own write-time redaction (design
 * D19, src/util/redact.ts in the copperhead checkout) — it exists
 * specifically to catch what that redaction misses. Confirmed by reading
 * redact.ts directly: it covers `sk-`, bearer tokens, npm, and GitHub, but
 * not Google/Gemini `AIza` keys, which is exactly the gap this list closes.
 */
export const CREDENTIAL_PATTERNS: { kind: string; pattern: RegExp }[] = [
  { kind: 'openai-anthropic', pattern: /sk-[A-Za-z0-9_-]{20,}/g },
  { kind: 'google-gemini', pattern: /AIza[0-9A-Za-z_-]{35}/g },
  { kind: 'http-bearer', pattern: /Bearer\s+[A-Za-z0-9._+/=-]{16,}/gi },
  { kind: 'npm', pattern: /npm_[A-Za-z0-9-]{36,}/g },
  { kind: 'github', pattern: /gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}/g },
];

/** Returns the kinds of credential found in content, empty if none. */
export function scanForSecrets(content: string): string[] {
  const hits: string[] = [];
  for (const { kind, pattern } of CREDENTIAL_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) hits.push(kind);
  }
  return hits;
}
