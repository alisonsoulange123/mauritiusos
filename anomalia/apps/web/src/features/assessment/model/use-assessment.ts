'use client';

import { useCallback, useState } from 'react';
import { ApiRequestError } from '@/shared/api/client';
import {
  startAssessment,
  submitAssessment,
  type AssessmentQuestion,
  type AssessmentResult,
} from '../api/assessment.api';

type Phase = 'idle' | 'loading' | 'answering' | 'submitting' | 'done' | 'error';

/**
 * The feature's state machine, kept out of the component.
 *
 * Feature-Sliced Design puts state in `model/` for a practical reason: the
 * funnel logic is testable without rendering, and the screen becomes a pure
 * function of this hook's return value. It also means a second surface (an
 * embedded widget, say) can reuse the whole funnel by calling the hook.
 *
 * Explicit phases rather than a bag of booleans — `loading && error` is not a
 * reachable state, and the type system should say so.
 */
export function useAssessment(locale: string) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [error, setError] = useState<{ message: string; traceId?: string } | null>(null);

  const begin = useCallback(
    async (source?: string) => {
      setPhase('loading');
      setError(null);
      try {
        const response = await startAssessment(locale, source);
        setAssessmentId(response.assessment_id);
        setQuestions(response.questions);
        setPhase('answering');
      } catch (caught) {
        setError(toDisplayError(caught));
        setPhase('error');
      }
    },
    [locale],
  );

  const answer = useCallback((questionId: string, value: unknown) => {
    setAnswers((previous) => ({ ...previous, [questionId]: value }));
  }, []);

  const submit = useCallback(async () => {
    if (!assessmentId) return;
    setPhase('submitting');
    try {
      setResult(await submitAssessment(assessmentId, answers));
      setPhase('done');
    } catch (caught) {
      setError(toDisplayError(caught));
      setPhase('error');
    }
  }, [assessmentId, answers]);

  const answeredCount = questions.filter((question) => answers[question.id] !== undefined).length;

  return {
    phase,
    questions,
    answers,
    result,
    error,
    begin,
    answer,
    submit,
    progress: questions.length === 0 ? 0 : Math.round((answeredCount / questions.length) * 100),
    canSubmit:
      phase === 'answering' &&
      questions.filter((question) => question.required).every((question) => answers[question.id] !== undefined),
  };
}

/** Keeps the traceId so support can be given something actionable. */
const toDisplayError = (caught: unknown): { message: string; traceId?: string } =>
  caught instanceof ApiRequestError
    ? { message: caught.message, traceId: caught.traceId }
    : { message: 'Something went wrong. Please try again.' };
