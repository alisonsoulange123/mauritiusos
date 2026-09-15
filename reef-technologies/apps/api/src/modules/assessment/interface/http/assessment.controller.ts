import { Body, Controller, Param, Post } from '@nestjs/common';
import { ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  CurrentActor,
  Public,
  type AuthenticatedActor,
} from '../../../../core/auth/auth.decorators.js';
import { zodBody } from '../../../../core/http/zod-validation.pipe.js';
import { StartAssessmentUseCase } from '../../application/start-assessment.usecase.js';
import { SubmitAssessmentUseCase } from '../../application/submit-assessment.usecase.js';

const startSchema = z.object({
  language: z.enum(['en', 'fr']).optional(),
  source: z.string().max(60).optional(),
});

const submitSchema = z.object({
  answers: z.object({
    nationality: z.string().length(2),
    age: z.number().int().min(18).max(100),
    occupation: z.string().min(1).max(60),
    income: z.number().nonnegative().max(10_000_000),
    currency: z.string().length(3).optional(),
    family: z.enum(['single', 'couple', 'family']),
    goal: z.string().min(1).max(60),
    timelineMonths: z.number().int().min(0).max(120).optional(),
  }),
});

/** API Contract Blueprint §5. Public: the funnel precedes registration. */
@ApiTags('assessment')
@Controller('assessment')
export class AssessmentController {
  constructor(
    private readonly start: StartAssessmentUseCase,
    private readonly submit: SubmitAssessmentUseCase,
  ) {}

  @Public()
  @Post('start')
  @ApiOperation({ summary: 'Begin an assessment and receive the questions' })
  async startAssessment(@Body(zodBody(startSchema)) body: z.infer<typeof startSchema>) {
    // Map the wire field (`language`, per the API Contract Blueprint) onto the
    // use case's `locale`. Passing `body` straight through silently dropped it
    // and every visitor got English questions.
    const result = await this.start.execute({
      ...(body.language ? { locale: body.language } : {}),
      ...(body.source ? { source: body.source } : {}),
    });
    return { assessment_id: result.assessmentId, questions: result.questions };
  }

  @Public()
  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit answers and receive the diagnosis' })
  async submitAssessment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(submitSchema)) body: z.infer<typeof submitSchema>,
    /*
     * Present only when the caller happens to be signed in.
     *
     * The route stays `@Public()` — the assessment is the top of the funnel and
     * must work for a visitor with no account. But the guard still binds an
     * actor when a valid token comes with the request, and until now nothing
     * read it: the completion event went out with no `userId`, so an answer set
     * from a signed-in person was indistinguishable from an anonymous one and
     * could never reach their profile.
     */
    @CurrentActor() actor: AuthenticatedActor | undefined,
  ) {
    return this.submit.execute({
      assessmentId: id,
      answers: body.answers,
      ...(actor ? { userId: actor.userId } : {}),
    });
  }
}
