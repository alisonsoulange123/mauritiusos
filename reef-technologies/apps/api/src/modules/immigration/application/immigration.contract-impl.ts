import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  EVENT_BUS,
  IMMIGRATION_CONTRACT,
  eligibilityInputSchema,
  type EligibilityInput,
  type EligibilityOutcome,
  type EventBus,
  type ImmigrationContract,
} from '@reef-technologies/contracts';
import { ContractRegistry } from '../../../core/contracts/contract-registry.js';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { ConfigService } from '../../../core/config/config.service.js';
import { EligibilityRule } from '../domain/eligibility-rule.js';
import type { ConditionOperator } from '../domain/rule-condition.js';
import { immigrationRules, ruleConditions } from '../infrastructure/immigration.schema.js';

/**
 * The synchronous contract other modules call. Assessment and ai-concierge
 * both consume it; neither knows this class exists.
 */
@Injectable()
export class ImmigrationContractImpl implements ImmigrationContract, OnModuleInit {
  private readonly logger = new Logger(ImmigrationContractImpl.name);

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    private readonly registry: ContractRegistry,
    private readonly tenantContext: TenantContext,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    this.registry.register(IMMIGRATION_CONTRACT, this, 'immigration');
  }

  async evaluate(input: EligibilityInput): Promise<EligibilityOutcome[]> {
    // Validate at the contract boundary. A caller is another module, not a
    // trusted co-author — treat its input like any other untrusted input.
    const facts = eligibilityInputSchema.parse(input);
    const tenantId = this.tenantContext.requireTenantId();
    const rules = await this.loadActiveRules(tenantId);

    const { IMMIGRATION_MIN_CONFIDENCE } = this.config.module<{ IMMIGRATION_MIN_CONFIDENCE: number }>();

    const outcomes = rules
      .map((rule) => rule.evaluate(facts as unknown as Record<string, unknown>))
      .filter((outcome) => outcome.confidence >= IMMIGRATION_MIN_CONFIDENCE)
      .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.confidence - a.confidence);

    return outcomes;
  }

  async evaluateBest(input: EligibilityInput): Promise<EligibilityOutcome | null> {
    const outcomes = await this.evaluate(input);
    const best = outcomes[0] ?? null;

    if (best) {
      // Announce the decision so analytics and the AI memory can record it,
      // without either being called from here.
      await this.events.publish('immigration.eligibility.evaluated', {
        userId: this.tenantContext.actorId() ?? '00000000-0000-0000-0000-000000000000',
        permitType: best.permitType,
        eligible: best.eligible,
        confidence: best.confidence,
        matchedRuleIds: best.matchedRuleIds,
      });
    }

    return best;
  }

  /** Loads rules with their conditions and rehydrates domain objects. */
  private async loadActiveRules(tenantId: string): Promise<EligibilityRule[]> {
    const rows = await this.database.db
      .select({
        ruleId: immigrationRules.id,
        name: immigrationRules.name,
        permitType: immigrationRules.permitType,
        requiredDocuments: immigrationRules.requiredDocuments,
        baseConfidence: immigrationRules.baseConfidence,
        conditionId: ruleConditions.id,
        field: ruleConditions.field,
        operator: ruleConditions.operator,
        value: ruleConditions.value,
        weight: ruleConditions.weight,
      })
      .from(immigrationRules)
      .leftJoin(ruleConditions, eq(ruleConditions.ruleId, immigrationRules.id))
      .where(and(eq(immigrationRules.tenantId, tenantId), eq(immigrationRules.active, true)));

    // One query, grouped in memory: a rule set is small and bounded, so N+1
    // queries per evaluation would be the worse trade.
    const grouped = new Map<string, EligibilityRule>();
    const buffers = new Map<
      string,
      { name: string; permitType: string; documents: string[]; base: number; conditions: Array<{ id: string; field: string; operator: ConditionOperator; value: string; weight: number }> }
    >();

    for (const row of rows) {
      const buffer =
        buffers.get(row.ruleId) ??
        {
          name: row.name,
          permitType: row.permitType,
          documents: row.requiredDocuments,
          base: row.baseConfidence / 100,
          conditions: [],
        };
      if (row.conditionId) {
        buffer.conditions.push({
          id: row.conditionId,
          field: row.field!,
          operator: row.operator as ConditionOperator,
          value: row.value!,
          weight: row.weight ?? 1,
        });
      }
      buffers.set(row.ruleId, buffer);
    }

    for (const [ruleId, buffer] of buffers) {
      grouped.set(
        ruleId,
        new EligibilityRule({
          id: ruleId,
          name: buffer.name,
          permitType: buffer.permitType,
          conditions: buffer.conditions,
          requiredDocuments: buffer.documents,
          baseConfidence: buffer.base,
        }),
      );
    }

    return [...grouped.values()];
  }
}
