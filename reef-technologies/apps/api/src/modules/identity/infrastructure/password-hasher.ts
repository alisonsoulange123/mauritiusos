import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { DomainError } from '@reef-technologies/contracts';
import { ConfigService } from '../../../core/config/config.service.js';

/**
 * The only place in the platform that touches a password.
 *
 * Extracted when password reset arrived and needed exactly the same rules as
 * registration. Two copies of an Argon2 parameter set is how a system ends up
 * with accounts hashed three different ways, and two copies of a length check
 * is how a reset form quietly becomes the weakest way in.
 */
@Injectable()
export class PasswordHasher {
  constructor(private readonly config: ConfigService) {}

  private get settings() {
    return this.config.module<{
      IDENTITY_PASSWORD_MIN_LENGTH: number;
      IDENTITY_ARGON_MEMORY_KIB: number;
    }>();
  }

  /**
   * Throws unless the password meets the policy.
   *
   * Separate from `hash` so a caller can check *before* doing something it
   * cannot undo. Password reset is the case that matters: consuming the link
   * first and validating second would burn a single-use token on a typo and
   * send the user back to their mailbox for a new one.
   */
  assertAcceptable(password: string): void {
    const { IDENTITY_PASSWORD_MIN_LENGTH } = this.settings;

    if (password.length < IDENTITY_PASSWORD_MIN_LENGTH) {
      throw new DomainError(
        'IDENTITY_PASSWORD_TOO_SHORT',
        `Password must be at least ${IDENTITY_PASSWORD_MIN_LENGTH} characters.`,
        422,
      );
    }
  }

  /** Validates the policy, then hashes. Refuses rather than silently accepting. */
  async hash(password: string): Promise<string> {
    this.assertAcceptable(password);
    const { IDENTITY_ARGON_MEMORY_KIB } = this.settings;

    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: IDENTITY_ARGON_MEMORY_KIB,
      timeCost: 3,
      parallelism: 4,
    });
  }

  /**
   * Verifies a password against a stored hash, or against a decoy when there
   * is none.
   *
   * The decoy is the point. Returning early for an unknown account makes the
   * response measurably faster than for a known one, which turns sign-in into
   * an account-enumeration oracle. Accepting `null` here means a caller cannot
   * forget to do this.
   */
  async verify(storedHash: string | null, password: string): Promise<boolean> {
    return argon2.verify(storedHash ?? DUMMY_HASH, password).catch(() => false);
  }
}

/** A real Argon2id hash of a random string — used only for timing parity. */
const DUMMY_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG';
