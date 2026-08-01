import { isLocalEndpoint } from 'copperhead/dist/config.js';

export type ModelSegment =
  | 'api-frontier'
  | 'api-cheap'
  | 'open-weight-hosted'
  | 'open-weight-self-hosted'
  | 'saved-login';

export interface ModelCostProfile {
  segment: ModelSegment;
  /** Always null in this pass — see STANDARD.md section 10 / design D9. */
  costUsd: null;
  note: string;
}

/**
 * Segment + cost classification for the single target model this pass
 * drives through the `compat:` route. Multi-provider/multi-model
 * classification (the direct-API and saved-login segments) is out of scope
 * — this pass targets one self-hosted open-weight model, not the first live
 * matrix (design migration step 4).
 *
 * A compat model against a loopback endpoint is open-weight self-hosted
 * (D9): the honest cost unit there is GPU-hours, not dollars, so cost.usd is
 * always null regardless of pricing.json, which needs no entry for this
 * segment. A compat model against a remote host would be open-weight
 * *hosted* and could in principle be priced, but that's not this pass's
 * target and pricing.json isn't touched here, so it reports null with an
 * explanatory note rather than fabricating a figure.
 */
export function classifyModel(model: string, baseURL: string | undefined): ModelCostProfile {
  if (!model.startsWith('compat:')) {
    throw new Error(
      `classifyModel only handles the compat: route (this pass targets one self-hosted open-weight ` +
        `model, not a provider matrix); got "${model}"`,
    );
  }
  if (isLocalEndpoint(baseURL)) {
    return {
      segment: 'open-weight-self-hosted',
      costUsd: null,
      note:
        'self-hosted open-weight model: cost is null by design (STANDARD.md section 10). ' +
        'tokensIn/tokensOut are still recorded; GPU-hours, not dollars, is the honest cost unit here.',
    };
  }
  return {
    segment: 'open-weight-hosted',
    costUsd: null,
    note:
      `hosted compat endpoint (${baseURL ?? '(none)'}) has no pricing.json entry in this pass; ` +
      'cost cannot be estimated. Add one before treating a run against this endpoint as costed.',
  };
}
