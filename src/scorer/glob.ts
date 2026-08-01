/**
 * Minimal glob-to-regex for `files_touched_subset` allowlist patterns:
 * `*` matches within one path segment, `**` matches across segments
 * (e.g. ".copperhead/**"). Sufficient for the patterns actually used in
 * assertions.json across the suite (exact paths, "dir/*.ext", "dir/**") —
 * not a general glob implementation, and not meant to become one.
 */
export function globToRegExp(glob: string): RegExp {
  let pattern = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        pattern += '.*';
        i++;
      } else {
        pattern += '[^/]*';
      }
    } else {
      pattern += c!.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${pattern}$`);
}
