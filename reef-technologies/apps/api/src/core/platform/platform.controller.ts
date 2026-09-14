import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MODULE_MANIFEST, type ModuleManifest } from '../module-system/module.definition.js';
import { ContractRegistry } from '../contracts/contract-registry.js';
import { ConfigService } from '../config/config.service.js';
import { Public } from '../auth/auth.decorators.js';
import { DATABASE, type DatabaseRef } from '../database/database.tokens.js';

/**
 * The platform's self-description.
 *
 * `/capabilities` is the contract that makes the FRONTEND plug-and-play: the
 * web app asks the API which modules are actually live and hides the features
 * that are not. Ship a build with the billing UI in it, leave FEATURE_BILLING
 * off, and no billing navigation appears — no frontend redeploy needed to
 * enable it later.
 */
/*
 * A far wider bucket than the 120/min default, because this controller is not
 * shaped like the rest of the API. It serves deployment metadata assembled
 * from an in-memory manifest — no database, no per-user data, identical for
 * every caller — and the web app reads it on every page render.
 *
 * On the default bucket a handful of visitors behind one NAT exhausted it, and
 * a throttled read used to be indistinguishable from "this deployment serves
 * nothing": navigation, the landing grid and the footer all emptied at once.
 * The frontend now keeps a last-known-good copy, but the limit that provoked
 * it was wrong on its own terms.
 */
@ApiTags('platform')
@Throttle({ default: { ttl: 60_000, limit: 1200 } })
@Controller('_platform')
export class PlatformController {
  constructor(
    @Inject(MODULE_MANIFEST) private readonly manifest: ModuleManifest,
    private readonly contracts: ContractRegistry,
    private readonly config: ConfigService,
    @Inject(DATABASE) private readonly database: DatabaseRef,
  ) {}

  @Public()
  @Get('capabilities')
  @ApiOperation({ summary: 'Modules and contracts live in this deployment' })
  capabilities() {
    return {
      app: this.config.core.APP_NAME,
      environment: this.config.core.NODE_ENV,
      modules: this.manifest.entries.map((entry) => ({
        key: entry.key,
        version: entry.version,
        enabled: entry.enabled,
        stability: entry.stability,
        description: entry.description,
      })),
      /** Enabled keys, for a cheap client-side lookup. */
      enabled: this.manifest.enabledKeys,
    };
  }

  @Public()
  @Get('topology')
  @ApiOperation({ summary: 'Event and contract wiring — the coupling audit' })
  topology() {
    // Renders the actual runtime coupling graph, which is the artifact you
    // want in a review when someone asks "what breaks if we remove this?".
    return {
      loadOrder: this.manifest.order,
      contracts: this.contracts.describe(),
      events: this.manifest.entries
        .filter((entry) => entry.enabled)
        .map((entry) => ({
          module: entry.key,
          publishes: entry.publishes,
          subscribes: entry.subscribes,
        })),
    };
  }

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Liveness and dependency health' })
  async health() {
    const databaseUp = await this.database.healthcheck();
    return {
      status: databaseUp ? 'ok' : 'degraded',
      checks: { database: databaseUp ? 'up' : 'down' },
      modules: this.manifest.enabledKeys.length,
    };
  }
}
