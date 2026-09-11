import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { FlagSet, LoadedEnv } from '@anomalia/config';
import { ConfigService } from './config.service.js';

/**
 * Global so no module has to remember to import it, and dynamic because the
 * validated env is produced *before* Nest starts — config must already be
 * proven valid by the time a provider could ask for it.
 */
@Global()
@Module({})
export class ConfigModule {
  static forRoot(env: LoadedEnv, flags: FlagSet): DynamicModule {
    return {
      module: ConfigModule,
      providers: [
        { provide: ConfigService, useValue: new ConfigService(env.core, env.modules, flags) },
      ],
      exports: [ConfigService],
    };
  }
}
