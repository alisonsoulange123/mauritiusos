import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { Page, Role } from '@anomalia/contracts';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { decodeTimeCursor, encodeTimeCursor } from '../../../core/http/cursor.js';
import { userProfiles, users } from '../infrastructure/identity.schema.js';

export interface ListUsersQuery {
  search?: string;
  role?: Role;
  status?: 'pending' | 'active' | 'suspended';
  /** Narrows to accounts that have not confirmed their address. */
  unverifiedOnly?: boolean;
  cursor?: string;
  limit: number;
}

export interface UserSummary {
  id: string;
  email: string;
  role: Role;
  status: 'pending' | 'active' | 'suspended';
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  createdAt: Date;
}

/**
 * The account directory behind the Back Office.
 *
 * Read-only and tenant-scoped, like everything else that touches users. The
 * filters are the ones an operator actually reaches for: find a person by
 * name or address, or list everyone stuck in a state — which in practice means
 * "who registered but never confirmed", the population that cannot be
 * promoted and does not know it.
 */
@Injectable()
export class ListUsersUseCase {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    private readonly tenantContext: TenantContext,
  ) {}

  async execute(query: ListUsersQuery): Promise<Page<UserSummary>> {
    const tenantId = this.tenantContext.requireTenantId();
    const cursor = decodeTimeCursor(query.cursor);

    const filters: Array<SQL | undefined> = [
      eq(users.tenantId, tenantId),
      query.role ? eq(users.role, query.role) : undefined,
      query.status ? eq(users.status, query.status) : undefined,
      query.unverifiedOnly ? sql`${users.emailVerifiedAt} is null` : undefined,
      // Row-wise comparison: see core/http/cursor for why the pair, not the
      // timestamp alone.
      cursor
        ? sql`(${users.createdAt}, ${users.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`
        : undefined,
      searchFilter(query.search),
    ];

    const rows = await this.database.db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        status: users.status,
        emailVerifiedAt: users.emailVerifiedAt,
        createdAt: users.createdAt,
        firstName: userProfiles.firstName,
        lastName: userProfiles.lastName,
      })
      .from(users)
      // Left join: a user without a profile is a data problem worth seeing in
      // the directory, not a row to hide from it.
      .leftJoin(
        userProfiles,
        and(eq(userProfiles.userId, users.id), eq(userProfiles.tenantId, tenantId)),
      )
      .where(and(...filters.filter((filter): filter is SQL => filter !== undefined)))
      .orderBy(desc(users.createdAt), desc(users.id))
      // One extra row tells us whether another page exists, without a count(*).
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => ({
        id: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        emailVerified: row.emailVerifiedAt !== null,
        firstName: row.firstName,
        lastName: row.lastName,
        createdAt: row.createdAt,
      })),
      nextCursor: hasMore && last ? encodeTimeCursor(last.createdAt, last.id) : null,
    };
  }
}

/**
 * Case-insensitive match across the address and the name.
 *
 * `ilike` with a leading wildcard cannot use a b-tree index, which is fine at
 * this size and would not be at a hundred thousand accounts — at that point
 * this becomes a trigram index or a tsvector, and the shape of the call here
 * does not change.
 */
function searchFilter(search: string | undefined): SQL | undefined {
  const term = search?.trim();
  if (!term) return undefined;

  const pattern = `%${term.replace(/[%_]/g, (match) => `\\${match}`)}%`;
  return or(
    ilike(users.email, pattern),
    ilike(userProfiles.firstName, pattern),
    ilike(userProfiles.lastName, pattern),
  );
}
