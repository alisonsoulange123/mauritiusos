/**
 * What an assessment's answers say about a person's profile.
 *
 * The assessment already asks for nationality, age, occupation, income and
 * family status, and stored them in a snapshot that went nowhere — while the
 * immigration engine and the concierge read those exact fields off the profile
 * and found them permanently null. The rules engine was resolving eligibility
 * from an empty profile for every signed-in user.
 *
 * Pure, because the interesting part is not the writing — it is deciding what
 * a free-form answer set is allowed to claim about someone.
 */

export interface ProfilePatch {
  nationality?: string;
  occupation?: string;
  monthlyIncome?: number;
  familyStatus?: 'single' | 'couple' | 'family';
  preferences?: Record<string, unknown>;
}

/** The profile fields this mapping is willing to touch, as stored today. */
export interface ExistingProfile {
  nationality: string | null;
  occupation: string | null;
  monthlyIncome: number | null;
  familyStatus: 'single' | 'couple' | 'family' | null;
}

const FAMILY_STATUSES = ['single', 'couple', 'family'] as const;

/**
 * Maps answers onto a patch, filling only what the profile does not already
 * hold.
 *
 * Fill-if-absent rather than overwrite, and the distinction matters: a profile
 * the person typed is a statement about themselves, while one inferred from a
 * funnel questionnaire is a by-product of a different task. A later assessment
 * silently replacing an edited field would let a throwaway answer overwrite a
 * considered one, with nothing on screen to say it happened.
 *
 * `age` is deliberately NOT mapped. The profile stores a birth date and derives
 * age from it, because a stored age is wrong within a year — so turning "47"
 * into a date would be inventing a fact the person never gave. Age reaches the
 * engine only from a birth date the profile owner entered.
 */
export function profilePatchFromAnswers(
  answers: Record<string, unknown>,
  existing: ExistingProfile,
): ProfilePatch {
  const patch: ProfilePatch = {};

  const nationality = countryCode(answers.nationality);
  if (nationality && !existing.nationality) patch.nationality = nationality;

  const occupation = nonEmptyString(answers.occupation);
  if (occupation && !existing.occupation) patch.occupation = occupation;

  const income = positiveInteger(answers.income);
  // `!= null` and not a truthiness check: a declared income of zero is an
  // answer, and treating it as absent would keep re-asking someone with none.
  if (income !== null && existing.monthlyIncome == null) patch.monthlyIncome = income;

  const family = familyStatus(answers.family);
  if (family && !existing.familyStatus) patch.familyStatus = family;

  // The goal is intent rather than identity, and has no column — it belongs in
  // the schemaless bag, where it can inform a recommendation without
  // pretending to be a fact about the person.
  const goal = nonEmptyString(answers.goal);
  if (goal) patch.preferences = { primaryIntent: goal };

  return patch;
}

/** ISO 3166-1 alpha-2, which is the only thing the eligibility rules match on. */
function countryCode(value: unknown): string | null {
  const text = nonEmptyString(value);
  return text && /^[A-Za-z]{2}$/.test(text) ? text.toUpperCase() : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed);
}

function familyStatus(value: unknown): 'single' | 'couple' | 'family' | null {
  const text = nonEmptyString(value);
  return text && (FAMILY_STATUSES as readonly string[]).includes(text)
    ? (text as 'single' | 'couple' | 'family')
    : null;
}
