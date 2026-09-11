import { Module } from '@nestjs/common';
import { AssessmentController } from './interface/http/assessment.controller.js';
import { StartAssessmentUseCase } from './application/start-assessment.usecase.js';
import { SubmitAssessmentUseCase } from './application/submit-assessment.usecase.js';

@Module({
  controllers: [AssessmentController],
  providers: [StartAssessmentUseCase, SubmitAssessmentUseCase],
})
export class AssessmentModule {}
