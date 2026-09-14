export interface AssessmentQuestion {
  id: string;
  type: 'number' | 'text' | 'select';
  question: string;
  options?: string[];
  required: boolean;
}

/**
 * The funnel questions, as data.
 *
 * Held here rather than in the frontend for two reasons: the API Contract
 * Blueprint has `POST /assessment/start` return them (so a second client can
 * never drift out of sync), and the scoring engine needs the same ids the form
 * submits. Copy is per-locale; ids never change.
 *
 * Six questions, deliberately — UX §5 trades completeness for completion rate.
 */
export const ASSESSMENT_QUESTIONS: Record<string, AssessmentQuestion[]> = {
  en: [
    { id: 'nationality', type: 'select', question: 'What is your nationality?', required: true },
    { id: 'age', type: 'number', question: 'How old are you?', required: true },
    {
      id: 'occupation',
      type: 'select',
      question: 'What is your current situation?',
      options: ['employed', 'self_employed', 'business_owner', 'retired', 'remote_worker'],
      required: true,
    },
    { id: 'income', type: 'number', question: 'What is your monthly income?', required: true },
    {
      id: 'family',
      type: 'select',
      question: 'Who is moving with you?',
      options: ['single', 'couple', 'family'],
      required: true,
    },
    {
      id: 'goal',
      type: 'select',
      question: 'What brings you to Mauritius?',
      options: ['retirement', 'investment', 'business', 'remote_work', 'family_relocation'],
      required: true,
    },
  ],
  fr: [
    { id: 'nationality', type: 'select', question: 'Quelle est votre nationalité ?', required: true },
    { id: 'age', type: 'number', question: 'Quel âge avez-vous ?', required: true },
    {
      id: 'occupation',
      type: 'select',
      question: 'Quelle est votre situation actuelle ?',
      options: ['employed', 'self_employed', 'business_owner', 'retired', 'remote_worker'],
      required: true,
    },
    { id: 'income', type: 'number', question: 'Quel est votre revenu mensuel ?', required: true },
    {
      id: 'family',
      type: 'select',
      question: 'Qui vous accompagne ?',
      options: ['single', 'couple', 'family'],
      required: true,
    },
    {
      id: 'goal',
      type: 'select',
      question: "Quel est votre projet à Maurice ?",
      options: ['retirement', 'investment', 'business', 'remote_work', 'family_relocation'],
      required: true,
    },
  ],
};
