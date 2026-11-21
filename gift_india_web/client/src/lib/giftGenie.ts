/**
 * GIFT Gauge — Genie prompt framing and scorecard context injection.
 * Genie queries workspace.gift_serving.* (mirrored from Lakebase gold.*);
 * the scorecard reads the same serving layer live from Lakebase.
 */

export type GiftGenieFacilityContext = {
  facilityId: string;
  name: string;
  district: string;
  state: string;
  stateCode?: string | null;
  type?: string | null;
  beds?: number | null;
  meanTrustScore?: number | null;
  flaggedCapabilityCount?: number;
};

export const GIFT_GENIE_ALIAS = 'gift';

export const GIFT_GENIE_FRAMEWORK = `GIFT Gauge (Governance, Integrity & Facility Trust) — facility capability trust for India. Trust signals: strong, partial, weak_suspicious, no_claim. Capabilities: ICU, maternity, emergency, trauma, oncology, NICU.`;

/** Wrap a value for natural-language prompts without breaking on embedded double quotes. */
function quoteForPrompt(value: string): string {
  if (value.includes('"')) {
    return `'${value.replace(/'/g, "\\'")}'`;
  }
  return `"${value}"`;
}

/** Starter prompts when no facility is selected on the scorecard. */
export function giftGenieGlobalPrompts(): string[] {
  return [
    'Which districts have the most facilities with contradicting ICU evidence?',
    'How many facilities in Uttar Pradesh claim ICU but have weak or suspicious evidence?',
    'List facilities in Maharashtra with Strong evidence tier for emergency capability.',
  ];
}

/** Facility-aware prompts seeded from the scorecard selection. */
export function giftGenieFacilityPrompts(ctx: GiftGenieFacilityContext): string[] {
  const loc = `${ctx.district}, ${ctx.state}`;
  const name = quoteForPrompt(ctx.name);
  return [
    `For facility ${name} (${ctx.facilityId}) in ${loc}: which capabilities have contradicting evidence?`,
    `How does the mean evidence_strength_score for ${name} compare to other hospitals in ${ctx.district}?`,
    ctx.flaggedCapabilityCount && ctx.flaggedCapabilityCount > 0
      ? `${name} has ${ctx.flaggedCapabilityCount} capabilities flagged for human review — summarize trust_signal and evidence_tier for those capabilities.`
      : `List facilities in ${ctx.state} with Strong ICU evidence in capability_scored.`,
  ];
}

/** Prefix user questions with scorecard context so Genie stays grounded in GIFT. */
export function giftGenieContextualizeQuestion(
  question: string,
  facility: GiftGenieFacilityContext | null,
): string {
  const trimmed = question.trim();
  if (!facility) {
    return trimmed;
  }
  const trust =
    facility.meanTrustScore != null
      ? ` Mean trust score on scorecard: ${Math.round(facility.meanTrustScore * 100)}/100.`
      : '';
  const flags =
    facility.flaggedCapabilityCount && facility.flaggedCapabilityCount > 0
      ? ` ${facility.flaggedCapabilityCount} capability(ies) flagged for manual human review.`
      : '';
  return (
    `Scorecard context — facility_id=${facility.facilityId}, name=${quoteForPrompt(facility.name)}, ` +
    `district=${facility.district}, state=${facility.state}` +
    (facility.stateCode ? ` (${facility.stateCode})` : '') +
    (facility.type ? `, type=${facility.type}` : '') +
    (facility.beds != null ? `, beds=${facility.beds}` : '') +
    `.${trust}${flags} ` +
    `Question: ${trimmed}`
  );
}
