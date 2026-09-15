import { z } from 'zod';
import { IDENTITY_CONTRACT } from '@reef-technologies/contracts';
import { defineModule } from '../../core/module-system/module.definition.js';
import { IdentityModule } from './identity.module.js';

/**
 * IDENTITY — the User Context (DDD blueprint §12).
 *
 * Part of the platform floor: `ALWAYS_ON` in the flag registry, because every
 * other module's authorization presumes a user exists. Core verifies tokens;
 * this module owns the records and the credentials.
 */
export default defineModule({
  key: 'identity',
  version: '1.0.0',
  description: 'Users, profiles, credentials and the user journey state machine.',
  nestModule: IdentityModule,
  stability: 'stable',
  configSchema: z.object({
    IDENTITY_PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(12),
    /** Argon2id memory cost in KiB — the Security blueprint's §26 preference. */
    IDENTITY_ARGON_MEMORY_KIB: z.coerce.number().int().min(19456).default(65536),
  }),
  provides: [IDENTITY_CONTRACT],
  /**
   * The funnel already asks for nationality, occupation, income and family
   * status — the exact fields the immigration rules match on. Identity listens
   * so that a completed assessment enriches the profile the engine reads.
   */
  subscribes: ['assessment.completed'],
  publishes: [
    'identity.user.registered',
    'identity.role.changed',
    'identity.email.verified',
    'identity.password.reset',
  ],
});
