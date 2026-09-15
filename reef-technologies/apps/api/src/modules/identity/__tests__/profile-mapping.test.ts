import { describe, expect, it } from 'vitest';
import { profilePatchFromAnswers, type ExistingProfile } from '../domain/profile-mapping.js';

const empty: ExistingProfile = {
  nationality: null,
  occupation: null,
  monthlyIncome: null,
  familyStatus: null,
};

const answers = {
  nationality: 'fr',
  age: 47,
  occupation: 'retired',
  income: 4200,
  family: 'couple',
  goal: 'retirement',
};

describe('profilePatchFromAnswers', () => {
  it('fills an empty profile from the funnel', () => {
    // The whole point: these are the fields the eligibility rules match on, and
    // they were null for every signed-in user.
    expect(profilePatchFromAnswers(answers, empty)).toEqual({
      nationality: 'FR',
      occupation: 'retired',
      monthlyIncome: 4200,
      familyStatus: 'couple',
      preferences: { primaryIntent: 'retirement' },
    });
  });

  it('never overwrites what the person entered themselves', () => {
    /*
     * A profile someone typed is a statement about themselves; one inferred
     * from a questionnaire is a by-product of a different task. Letting a
     * throwaway answer replace a considered one — with nothing on screen to
     * say so — is the failure this guards.
     */
    const patch = profilePatchFromAnswers(answers, {
      nationality: 'BE',
      occupation: 'employed',
      monthlyIncome: 9000,
      familyStatus: 'single',
    });

    expect(patch.nationality).toBeUndefined();
    expect(patch.occupation).toBeUndefined();
    expect(patch.monthlyIncome).toBeUndefined();
    expect(patch.familyStatus).toBeUndefined();
  });

  it('treats a declared income of zero as an answer, not an absence', () => {
    // A truthiness check would read 0 as "not answered" and keep asking
    // someone who told us they have no income.
    expect(profilePatchFromAnswers({ ...answers, income: 0 }, empty).monthlyIncome).toBe(0);

    // …and an existing zero blocks the fill, for the same reason.
    expect(
      profilePatchFromAnswers(answers, { ...empty, monthlyIncome: 0 }).monthlyIncome,
    ).toBeUndefined();
  });

  it('never invents a birth date from an age', () => {
    /*
     * The profile stores a birth date and derives age, because a stored age is
     * wrong within a year. Turning "47" into a date would be recording a fact
     * the person never gave — so age reaches the engine only from a birth date
     * its owner entered.
     */
    const patch = profilePatchFromAnswers(answers, empty) as Record<string, unknown>;

    expect(patch.birthDate).toBeUndefined();
    expect(patch.age).toBeUndefined();
  });

  it('refuses answers that are not what they claim to be', () => {
    const patch = profilePatchFromAnswers(
      { nationality: 'France', occupation: '   ', income: -5, family: 'complicated' },
      empty,
    );

    // A country NAME is not a country code, and the rules match on codes.
    expect(patch.nationality).toBeUndefined();
    expect(patch.occupation).toBeUndefined();
    expect(patch.monthlyIncome).toBeUndefined();
    expect(patch.familyStatus).toBeUndefined();
  });

  it('ignores an answer set that says nothing useful', () => {
    expect(profilePatchFromAnswers({}, empty)).toEqual({});
  });
});
