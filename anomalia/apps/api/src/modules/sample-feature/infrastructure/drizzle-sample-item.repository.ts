import { Inject, Injectable } from '@nestjs/common';
import { asc, count, eq, gt } from 'drizzle-orm';
import type { Page, PageQuery } from '@anomalia/contracts';
import { withTenant } from '@anomalia/db';
import { DATABASE, type DatabaseRef } from '../../../core/database/database.tokens.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import { SampleItem } from '../domain/sample-item.entity.js';
import type { SampleItemRepository } from '../domain/sample-item.repository.js';
import { sampleItems, type SampleItemRow } from './sample-feature.schema.js';

/**
 * The repository ADAPTER: the only file in this module that knows SQL exists.
 *
 * Everything above it — entity, use cases, controller — would run unchanged
 * against a different store. Two invariants it upholds on their behalf:
 *
 *  • Every query goes through `withTenant()`, so tenant scoping cannot be
 *    forgotten (and Postgres RLS backs it up if it ever is).
 *  • Rows are mapped to entities at the boundary. A `SampleItemRow` never
 *    escapes this file, so a column rename cannot ripple into the domain.
 */
@Injectable()
export class DrizzleSampleItemRepository implements SampleItemRepository {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    private readonly tenantContext: TenantContext,
  ) {}

  private get tenantId(): string {
    return this.tenantContext.requireTenantId();
  }

  async save(item: SampleItem): Promise<void> {
    const snapshot = item.snapshot();
    await this.database.db
      .insert(sampleItems)
      .values({
        id: snapshot.id,
        tenantId: snapshot.tenantId,
        ownerId: snapshot.ownerId,
        title: snapshot.title,
        notes: snapshot.notes,
        status: snapshot.status,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
      })
      // Upsert so the port needs one `save` rather than create/update — the
      // domain decides what changed, not the caller.
      .onConflictDoUpdate({
        target: sampleItems.id,
        set: { title: snapshot.title, notes: snapshot.notes, status: snapshot.status, updatedAt: snapshot.updatedAt },
      });
  }

  async findById(id: string): Promise<SampleItem | null> {
    const rows = await this.database.db
      .select()
      .from(sampleItems)
      .where(withTenant(sampleItems, this.tenantId, eq(sampleItems.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? this.toEntity(row) : null;
  }

  async list(query: PageQuery): Promise<Page<SampleItem>> {
    // Keyset pagination on the id: stable under concurrent inserts, where an
    // OFFSET would skip or repeat rows as the table shifts underneath.
    const rows = await this.database.db
      .select()
      .from(sampleItems)
      .where(
        withTenant(
          sampleItems,
          this.tenantId,
          query.cursor ? gt(sampleItems.id, query.cursor) : undefined,
        ),
      )
      .orderBy(asc(sampleItems.id))
      .limit(query.limit + 1); // one extra row tells us whether more exist

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      items: page.map((row) => this.toEntity(row)),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async countAll(): Promise<number> {
    const rows = await this.database.db
      .select({ value: count() })
      .from(sampleItems)
      .where(withTenant(sampleItems, this.tenantId));
    return rows[0]?.value ?? 0;
  }

  async delete(id: string): Promise<void> {
    await this.database.db
      .delete(sampleItems)
      .where(withTenant(sampleItems, this.tenantId, eq(sampleItems.id, id)));
  }

  /** Row -> entity. The anti-corruption boundary. */
  private toEntity(row: SampleItemRow): SampleItem {
    return SampleItem.fromPersistence({
      id: row.id,
      tenantId: row.tenantId,
      ownerId: row.ownerId,
      title: row.title,
      notes: row.notes,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }
}
