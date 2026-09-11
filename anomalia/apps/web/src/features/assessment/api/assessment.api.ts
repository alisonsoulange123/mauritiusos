import { z } from 'zod';
import { apiRequest } from '@/shared/api/client';

/**
 * This feature's API surface. Response schemas are parsed, not cast: an API
 * change becomes a clear error here instead of `undefined` deep in a render.
 */

export const questionSchema = z.object({
  id: z.string(),
  type: z.enum(['number', 'text', 'select']),
  question: z.string(),
  options: z.array(z.string()).optional(),
  required: z.boolean(),
});

const startResponseSchema = z.object({
  assessment_id: z.string().uuid(),
  questions: z.array(questionSchema),
});

const resultSchema = z.object({
  score: z.number(),
  summary: z.string(),
  recommendation: z.object({
    permit: z.string().nullable(),
    confidence: z.number(),
    requiredDocuments: z.array(z.string()),
    knowledge: z.array(z.object({ title: z.string(), slug: z.string() })),
  }),
  requiresAdvisorReview: z.boolean(),
});

export type AssessmentQuestion = z.infer<typeof questionSchema>;
export type AssessmentResult = z.infer<typeof resultSchema>;

export const startAssessment = async (locale: string, source?: string) =>
  startResponseSchema.parse(
    await apiRequest('/assessment/start', {
      method: 'POST',
      body: { language: locale, ...(source ? { source } : {}) },
    }),
  );

export const submitAssessment = async (assessmentId: string, answers: Record<string, unknown>) =>
  resultSchema.parse(
    await apiRequest(`/assessment/${assessmentId}/submit`, {
      method: 'POST',
      body: { answers },
    }),
  );
