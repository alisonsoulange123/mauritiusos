import { DomainError } from '@reef-technologies/contracts';

export type ConditionOperator = 'eq' | 'ne' | 'gte' | 'lte' | 'gt' | 'lt' | 'in' | 'not_in';

export interface RuleCondition {
  id: string;
  field: string;
  operator: ConditionOperator;
  value: string;
  /** Contribution to the outcome's confidence when satisfied. */
  weight: number;
}

/**
 * A DECLARATIVE rule condition, matching the ERD's `rule_conditions` table.
 *
 * Rules are data, not code. A knowledge manager changes an income threshold
 * through the back office and it takes effect immediately — no deploy, no
 * engineer. That is the difference between a platform and a hardcoded
 * questionnaire, and it is the reason this evaluator exists instead of a
 * switch statement per permit type.
 */
export const evaluateCondition = (
  condition: RuleCondition,
  facts: Record<string, unknown>,
): boolean => {
  const actual = facts[condition.field];
  if (actual === undefined || actual === null) return false;

  switch (condition.operator) {
    case 'eq':
      return String(actual).toLowerCase() === condition.value.toLowerCase();
    case 'ne':
      return String(actual).toLowerCase() !== condition.value.toLowerCase();
    case 'gte':
      return toNumber(actual, condition) >= Number(condition.value);
    case 'lte':
      return toNumber(actual, condition) <= Number(condition.value);
    case 'gt':
      return toNumber(actual, condition) > Number(condition.value);
    case 'lt':
      return toNumber(actual, condition) < Number(condition.value);
    case 'in':
      return condition.value
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .includes(String(actual).toLowerCase());
    case 'not_in':
      return !condition.value
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .includes(String(actual).toLowerCase());
    default: {
      // Exhaustiveness: adding an operator to the union without handling it
      // here becomes a compile error.
      const unreachable: never = condition.operator;
      throw new DomainError('IMMIGRATION_UNKNOWN_OPERATOR', `Unsupported operator: ${String(unreachable)}`, 500);
    }
  }
};

const toNumber = (value: unknown, condition: RuleCondition): number => {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new DomainError(
      'IMMIGRATION_NON_NUMERIC_FACT',
      `Condition on "${condition.field}" expects a number but received "${String(value)}".`,
      422,
    );
  }
  return parsed;
};
