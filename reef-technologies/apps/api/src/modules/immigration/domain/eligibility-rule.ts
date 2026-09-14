import type { EligibilityOutcome } from '@reef-technologies/contracts';
import { evaluateCondition, type RuleCondition } from './rule-condition.js';

export interface EligibilityRuleProps {
  id: string;
  name: string;
  permitType: string;
  conditions: RuleCondition[];
  requiredDocuments: string[];
  /** Ceiling on confidence — reflects how well-sourced the rule itself is. */
  baseConfidence: number;
}

/**
 * One permit pathway, evaluated as a whole.
 *
 * Design decision worth flagging: confidence is the WEIGHTED PROPORTION of
 * satisfied conditions, capped by the rule's own base confidence. A partial
 * match therefore yields a partial score rather than a flat "no", which is
 * what feeds the AI blueprint's human-in-the-loop bands (§17):
 *
 *   > 0.9   answer automatically
 *   0.5–0.9 answer, flag for advisor review
 *   < 0.5   route to a human before replying
 *
 * A boolean eligible/not-eligible engine could not express that, and would
 * either over-promise or drop borderline users who are the most valuable to
 * talk to.
 */
export class EligibilityRule {
  constructor(private readonly props: EligibilityRuleProps) {}

  evaluate(facts: Record<string, unknown>): EligibilityOutcome {
    const totalWeight = this.props.conditions.reduce((sum, condition) => sum + condition.weight, 0);
    const satisfied: RuleCondition[] = [];
    const failed: RuleCondition[] = [];

    for (const condition of this.props.conditions) {
      (evaluateCondition(condition, facts) ? satisfied : failed).push(condition);
    }

    const satisfiedWeight = satisfied.reduce((sum, condition) => sum + condition.weight, 0);
    const ratio = totalWeight === 0 ? 0 : satisfiedWeight / totalWeight;

    return {
      permitType: this.props.permitType,
      // Eligible only when EVERY condition holds. Immigration rules are
      // conjunctive; "mostly eligible" is not a legal state.
      eligible: failed.length === 0,
      confidence: round(ratio * this.props.baseConfidence),
      matchedRuleIds: satisfied.map((condition) => condition.id),
      requiredDocuments: this.props.requiredDocuments,
      reasons:
        failed.length === 0
          ? [`All ${satisfied.length} conditions for ${this.props.name} are satisfied.`]
          : failed.map((condition) => `Requires ${condition.field} ${condition.operator} ${condition.value}.`),
    };
  }

  get id(): string { return this.props.id; }
  get permitType(): string { return this.props.permitType; }
}

const round = (value: number): number => Math.round(value * 100) / 100;
