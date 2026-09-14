import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EVENT_BUS, type EventBus } from '@reef-technologies/contracts';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { assessments } from '../infrastructure/assessment.schema.js';
import { ASSESSMENT_QUESTIONS } from '../domain/questions.js';

@Injectable()
export class StartAssessmentUseCase {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    private readonly tenantContext: TenantContext,
  ) {}

  async execute(input: { locale?: string; source?: string }) {
    const tenantId = this.tenantContext.requireTenantId();
    const assessmentId = randomUUID();
    const locale = input.locale ?? this.tenantContext.locale();

    await this.database.db.insert(assessments).values({
      id: assessmentId,
      tenantId,
      locale,
      acquisitionSource: input.source ?? null,
    });

    await this.events.publish('assessment.started', {
      assessmentId,
      locale,
      ...(input.source ? { acquisitionSource: input.source } : {}),
    });

    return { assessmentId, questions: ASSESSMENT_QUESTIONS[locale] ?? ASSESSMENT_QUESTIONS.en };
  }
}
