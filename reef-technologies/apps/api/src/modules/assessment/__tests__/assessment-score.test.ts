import { describe, expect, it } from 'vitest';
import { scoreAssessment } from '../domain/assessment-score.js';

describe('scoreAssessment', () => {
  it('scores the blueprint retiree example as highly qualified', () => {
    // Jean Dupont: French, 62, retired, €5000/month, moving within 6 months.
    const score = scoreAssessment({
      eligibleForPermit: true,
      permitConfidence: 0.95,
      monthlyIncome: 5000,
      hasCompleteProfile: true,
      timelineMonths: 6,
    });
    expect(score).toBeGreaterThanOrEqual(90);
  });

  it('still treats an ineligible profile as a lead', () => {
    const score = scoreAssessment({
      eligibleForPermit: false,
      permitConfidence: 0.8,
      monthlyIncome: 4500,
      hasCompleteProfile: true,
      timelineMonths: 12,
    });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(60);
  });

  it('rewards urgency', () => {
    const base = { eligibleForPermit: true, permitConfidence: 1, monthlyIncome: 4000, hasCompleteProfile: true };
    const soon = scoreAssessment({ ...base, timelineMonths: 3 });
    const later = scoreAssessment({ ...base, timelineMonths: 24 });
    expect(soon).toBeGreaterThan(later);
  });

  it('stays within 0–100 under extreme input', () => {
    const score = scoreAssessment({
      eligibleForPermit: true,
      permitConfidence: 1,
      monthlyIncome: 10_000_000,
      hasCompleteProfile: true,
      timelineMonths: 0,
    });
    expect(score).toBe(100);
  });

  it('scores an empty profile at zero without throwing', () => {
    const score = scoreAssessment({
      eligibleForPermit: false,
      permitConfidence: 0,
      monthlyIncome: 0,
      hasCompleteProfile: false,
      timelineMonths: null,
    });
    expect(score).toBe(0);
  });
});
