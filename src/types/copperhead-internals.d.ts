/**
 * Ambient types for the copperhead internals copperbench deep-imports from
 * `dist/`. copperhead ships no `.d.ts` (see CLAUDE.md and package.json's own
 * comment: these are not a stable public API), so this file is the single
 * place that names exactly which functions and shapes we depend on — pin an
 * exact copperhead version/commit (design D8) and treat a mismatch here
 * against copperhead's actual exports as a suite-version event, the same as
 * any other internals change. Grown module-by-module as the runner and
 * scorer come to need more of copperhead's internals.
 */

declare module 'copperhead/dist/config.js' {
  /**
   * True when baseURL is a loopback host (localhost/127.0.0.1/::1/.local),
   * per copperhead's own credential-waiver rule for local endpoints like
   * Ollama.
   */
  export function isLocalEndpoint(baseURL: string | undefined): boolean;
}
