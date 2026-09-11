'use client';

import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { ProgressBar } from '@/components/ui/progress-bar';
import type { FeatureScreenProps } from '../../feature.definition';
import { useAssessment } from '../model/use-assessment';
import type { AssessmentResult as AssessmentResultDto } from '../api/assessment.api';

/**
 * The screen. Presentation only — every decision comes from the hook.
 *
 * `export default` is required: the registry's `mount()` resolves to a module
 * with a default export.
 */
export default function AssessmentScreen({ locale }: FeatureScreenProps) {
  const assessment = useAssessment(locale);

  if (assessment.phase === 'idle') {
    return (
      <Card className="max-w-xl">
        <h1 className="text-title text-balance">Can you move to Mauritius?</h1>
        <p className="mt-4 text-body text-muted text-pretty">
          Six questions. No account needed. You will see which residence pathway fits your
          situation and what to prepare next.
        </p>
        <Button className="mt-7" size="lg" onClick={() => void assessment.begin()}>
          Start the assessment
        </Button>
      </Card>
    );
  }

  if (assessment.phase === 'error') {
    return (
      <Card className="mx-auto max-w-xl">
        <h2 className="text-heading">We could not continue</h2>
        <p className="mt-2 text-body text-muted">{assessment.error?.message}</p>
        {assessment.error?.traceId ? (
          // Surfacing the trace id turns "it broke" into a one-query lookup.
          <p className="mt-3 font-mono text-caption text-muted">Reference: {assessment.error.traceId}</p>
        ) : null}
        <Button className="mt-6" variant="secondary" onClick={() => void assessment.begin()}>
          Try again
        </Button>
      </Card>
    );
  }

  if (assessment.phase === 'done' && assessment.result) {
    return <AssessmentResultView result={assessment.result} />;
  }

  return (
    <Card className="mx-auto max-w-xl">
      <ProgressBar value={assessment.progress} />
      <div className="mt-6 space-y-5">
        {assessment.questions.map((question) => (
          <Field
            key={question.id}
            id={question.id}
            label={question.question}
            type={question.type}
            options={question.options}
            required={question.required}
            value={assessment.answers[question.id]}
            onChange={(value) => assessment.answer(question.id, value)}
          />
        ))}
      </div>
      <Button
        className="mt-8 w-full"
        disabled={!assessment.canSubmit || assessment.phase === 'submitting'}
        onClick={() => void assessment.submit()}
      >
        {assessment.phase === 'submitting' ? 'Analysing…' : 'See my result'}
      </Button>
    </Card>
  );
}

/**
 * The result view, split out so the screen stays within the complexity budget
 * and each phase of the funnel reads as its own unit.
 */
function AssessmentResultView({ result }: { result: AssessmentResultDto }) {
  return (
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <Card className="mx-auto max-w-2xl">
          <div className="flex items-baseline justify-between">
            <h2 className="text-heading">Your result</h2>
            <span className="text-title tabular-nums">{result.score}</span>
          </div>
          <p className="mt-3 text-body text-ink">{result.summary}</p>

          {result.recommendation.permit ? (
            <div className="mt-6 rounded-lg border border-hairline/[0.12] p-4">
              <p className="text-eyebrow uppercase text-muted">
                Suggested pathway
              </p>
              <p className="mt-1 font-medium">{result.recommendation.permit.replace(/_/g, ' ')}</p>
              <p className="mt-1 text-caption text-muted">
                Confidence {Math.round(result.recommendation.confidence * 100)}%
              </p>
              {result.recommendation.requiredDocuments.length > 0 ? (
                <ul className="mt-3 list-inside list-disc text-body text-muted">
                  {result.recommendation.requiredDocuments.map((document) => (
                    <li key={document}>{document.replace(/_/g, ' ')}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {result.requiresAdvisorReview ? (
            // The human-in-the-loop guardrail, made visible. The platform must
            // never imply legal certainty it does not have.
            <p className="mt-4 rounded-lg border border-hairline/[0.16] p-4 text-body text-ink">
              Your situation has details worth discussing with an advisor before you act on this.
            </p>
          ) : null}
        </Card>
      </motion.div>
    );
}
