import { Injectable, Logger } from '@nestjs/common';
import { DomainError, ERROR_CODES, type ContractToken } from '@reef-technologies/contracts';

/**
 * The synchronous half of inter-module communication.
 *
 * Nest's own DI cannot serve this purpose: injecting `ImmigrationService` into
 * the assessment module would mean importing the immigration module's class,
 * which is precisely the coupling we are eliminating. The registry inverts it —
 * providers register an implementation against a token declared in
 * `@reef-technologies/contracts`, consumers resolve the token, and neither side ever
 * imports the other.
 *
 * Practical consequences:
 *   • Deleting a module breaks nothing at compile time.
 *   • `tryGet` lets a consumer degrade gracefully when a provider is disabled.
 *   • `get` throws a 503 with the token name — a legible failure, not a
 *     `Cannot read property of undefined`.
 */
@Injectable()
export class ContractRegistry {
  private readonly logger = new Logger(ContractRegistry.name);
  private readonly implementations = new Map<string, unknown>();
  private readonly owners = new Map<string, string>();

  /** Called by a providing module in its `onModuleInit`. */
  register<T>(token: ContractToken<T>, implementation: T, ownerModule: string): void {
    const existing = this.owners.get(token.key);
    if (existing) {
      throw new Error(
        `Contract "${token.key}" is already provided by "${existing}"; "${ownerModule}" cannot also provide it. ` +
          'A contract has exactly one implementation per deployment.',
      );
    }
    this.implementations.set(token.key, implementation);
    this.owners.set(token.key, ownerModule);
    this.logger.log(`contract "${token.key}" registered by ${ownerModule}`);
  }

  /** Resolve or fail. Use when the caller genuinely cannot proceed without it. */
  get<T>(token: ContractToken<T>): T {
    const implementation = this.implementations.get(token.key);
    if (!implementation) {
      throw new DomainError(
        ERROR_CODES.CONTRACT_UNAVAILABLE,
        `Contract "${token.key}" is not available. The providing module is disabled or failed to register.`,
        503,
      );
    }
    return implementation as T;
  }

  /** Resolve or undefined. Use when the feature can degrade. */
  tryGet<T>(token: ContractToken<T>): T | undefined {
    return this.implementations.get(token.key) as T | undefined;
  }

  has(token: ContractToken<unknown>): boolean {
    return this.implementations.has(token.key);
  }

  /** Snapshot for the capabilities endpoint. */
  describe(): Array<{ contract: string; providedBy: string }> {
    return [...this.owners.entries()].map(([contract, providedBy]) => ({ contract, providedBy }));
  }
}
