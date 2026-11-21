import { describe, it, expect } from 'vitest';
import {
  giftGenieContextualizeQuestion,
  giftGenieFacilityPrompts,
  type GiftGenieFacilityContext,
} from './giftGenie';

const baseCtx: GiftGenieFacilityContext = {
  facilityId: 'dc80c270-ec41-4542-89d7-ebe31e8407f8',
  name: '"BA" Smt. Lilaben Chimanlal Parikh Cancer Centre',
  district: 'Navsari',
  state: 'Gujarat',
};

describe('giftGenieFacilityPrompts', () => {
  it('does not nest double quotes when the facility name already contains them', () => {
    const [first, second] = giftGenieFacilityPrompts(baseCtx);

    expect(first).toBe(
      "For facility '\"BA\" Smt. Lilaben Chimanlal Parikh Cancer Centre' (dc80c270-ec41-4542-89d7-ebe31e8407f8) in Navsari, Gujarat: which capabilities have contradicting evidence?",
    );
    expect(first).not.toContain('""BA"');
    expect(second).toBe(
      "How does the mean evidence_strength_score for '\"BA\" Smt. Lilaben Chimanlal Parikh Cancer Centre' compare to other hospitals in Navsari?",
    );
  });

  it('wraps plain facility names in double quotes', () => {
    const [first] = giftGenieFacilityPrompts({
      ...baseCtx,
      name: 'Apollo Hospital',
    });

    expect(first).toContain('For facility "Apollo Hospital"');
  });

  it('escapes single quotes when wrapping names that contain double quotes', () => {
    const [, , third] = giftGenieFacilityPrompts({
      ...baseCtx,
      name: '"BA" St. Mary\'s Clinic',
      flaggedCapabilityCount: 2,
    });

    expect(third).toContain("'\"BA\" St. Mary\\'s Clinic'");
  });
});

describe('giftGenieContextualizeQuestion', () => {
  it('quotes embedded double quotes in scorecard context', () => {
    const result = giftGenieContextualizeQuestion(
      'Which capabilities have contradicting evidence?',
      baseCtx,
    );

    expect(result).toContain("name='\"BA\" Smt. Lilaben Chimanlal Parikh Cancer Centre'");
    expect(result).not.toContain('name=""BA"');
  });
});
