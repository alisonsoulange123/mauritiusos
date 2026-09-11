export interface ScoringFacts {
  eligibleForPermit: boolean;
  permitConfidence: number;
  monthlyIncome: number;
  hasCompleteProfile: boolean;
  timelineMonths: number | null;
}

/**
 * Lead scoring, kept as a pure function.
 *
 * Business, not technical: the weights encode who the business can actually
 * help soonest. Pure and dependency-free so a product decision to reweight it
 * is a one-line change with a test, not an archaeology exercise.
 *
 *   eligibility  50  — can they legally come at all?
 *   income       25  — can they afford the services?
 *   urgency      15  — are they moving this year?
 *   completeness 10  — did they give us enough to help?
 */
export const scoreAssessment = (facts: ScoringFacts): number => {
  let score = 0;

  if (facts.eligibleForPermit) score += 50 * facts.permitConfidence;
  else score += 15 * facts.permitConfidence; // a near-miss is still a lead

  // Banded rather than linear: €20k/month is not four times the lead €5k is.
  if (facts.monthlyIncome >= 8000) score += 25;
  else if (facts.monthlyIncome >= 4000) score += 20;
  else if (facts.monthlyIncome >= 2500) score += 12;
  else if (facts.monthlyIncome > 0) score += 5;

  if (facts.timelineMonths !== null) {
    if (facts.timelineMonths <= 6) score += 15;
    else if (facts.timelineMonths <= 12) score += 10;
    else score += 4;
  }

  if (facts.hasCompleteProfile) score += 10;

  return Math.max(0, Math.min(100, Math.round(score)));
};
