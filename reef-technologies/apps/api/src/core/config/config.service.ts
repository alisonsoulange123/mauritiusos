import { Injectable } from '@nestjs/common';
import type { ModuleKey } from '@reef-technologies/contracts';
import { isModuleEnabled, type CoreEnv, type FlagSet } from '@reef-technologies/config';

/**
 * The ONLY legitimate reader of configuration in the running process.
 *
 * `process.env` is read exactly once, at boot, by `loadServerEnv`. Everything
 * else injects this service, which means configuration is typed, validated,
 * and stubbable in a test without touching globals.
 */
@Injectable()
export class ConfigService {
  constructor(
    readonly core: CoreEnv,
    private readonly moduleEnv: Record<string, unknown>,
    private readonly flags: FlagSet,
  ) {}

  /** Typed access to a module's own validated env vars. */
  module<T extends Record<string, unknown>>(): T {
    return this.moduleEnv as T;
  }

  isEnabled(key: ModuleKey): boolean {
    return isModuleEnabled(this.flags, key);
  }

  get isProduction(): boolean {
    return this.core.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.core.NODE_ENV === 'test';
  }
}
