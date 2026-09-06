// copperhead ships JavaScript with no type declarations. These are the only
// internals the scorer touches, declared narrowly on purpose.
//
// STANDARD.md and CLAUDE.md are explicit that copperhead's src/ internals are
// NOT a stable public API: the version is pinned, stamped into every result
// record, and an internals change is a suite-version event. Keeping this
// surface to two functions is what makes that promise cheap to keep.

declare module 'copperhead/dist/kicad/sexp.js' {
  export interface KicadSymbol {
    ref: string;
    value: string;
    footprint?: string | undefined;
    libId?: string | undefined;
  }

  /** Net names visible via labels and power symbols, across all sheets. */
  export function listNets(rootSchematicPath: string): Promise<string[]>;

  /** Non-power symbols across all sheets, sorted by reference designator. */
  export function listSymbols(rootSchematicPath: string): Promise<KicadSymbol[]>;
}
