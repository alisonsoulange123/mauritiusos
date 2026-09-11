import { describe, expect, it } from 'vitest';
import { EligibilityRule } from '../domain/eligibility-rule.js';

/** The blueprint's worked example: French retiree, 62, €5000/month. */
const retirementRule = new EligibilityRule({
  id: 'rule-retirement',
  name: 'Retirement Residence Permit',
  permitType: 'retirement_residence',
  baseConfidence: 0.95,
  requiredDocuments: ['passport', 'proof_of_income', 'medical_certificate'],
  conditions: [
    { id: 'c-age', field: 'age', operator: 'gte', value: '50', weight: 3 },
    { id: 'c-income', field: 'monthlyIncome', operator: 'gte', value: '2500', weight: 3 },
    { id: 'c-purpose', field: 'purpose', operator: 'eq', value: 'retirement', weight: 1 },
  ],
});

describe('EligibilityRule', () => {
  it('clears a fully qualifying profile with high confidence', () => {
    const outcome = retirementRule.evaluate({
      age: 62,
      monthlyIncome: 5000,
      purpose: 'retirement',
      nationality: 'FR',
    });
    expect(outcome.eligible).toBe(true);
    expect(outcome.confidence).toBeCloseTo(0.95, 2);
    expect(outcome.matchedRuleIds).toHaveLength(3);
    expect(outcome.requiredDocuments).toContain('proof_of_income');
  });

  it('scores a partial match proportionally instead of returning a flat no', () => {
    // Age and purpose hold (weight 4 of 7); income does not.
    const outcome = retirementRule.evaluate({ age: 62, monthlyIncome: 900, purpose: 'retirement' });
    expect(outcome.eligible).toBe(false);
    expect(outcome.confidence).toBeCloseTo((4 / 7) * 0.95, 2);
  });

  it('explains exactly which condition failed', () => {
    const outcome = retirementRule.evaluate({ age: 41, monthlyIncome: 5000, purpose: 'retirement' });
    expect(outcome.eligible).toBe(false);
    expect(outcome.reasons).toEqual(['Requires age gte 50.']);
  });

  it('treats a missing fact as unsatisfied rather than throwing', () => {
    const outcome = retirementRule.evaluate({ age: 62 });
    expect(outcome.eligible).toBe(false);
    expect(outcome.confidence).toBeGreaterThan(0);
  });

  it('lands borderline profiles in the advisor-review band', () => {
    const outcome = retirementRule.evaluate({ age: 62, monthlyIncome: 5000 });
    expect(outcome.confidence).toBeGreaterThan(0.5);
    expect(outcome.confidence).toBeLessThan(0.9);
  });
});
