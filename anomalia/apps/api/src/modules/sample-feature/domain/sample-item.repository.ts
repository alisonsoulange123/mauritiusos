import type { Page, PageQuery } from '@anomalia/contracts';
import type { SampleItem } from './sample-item.entity.js';

/**
 * The repository PORT (hexagonal architecture).
 *
 * Declared in the domain, implemented in infrastructure. The inversion is what
 * lets the domain and use cases be tested against an in-memory fake — no
 * Postgres, no containers, no fixtures — while production swaps in Drizzle.
 *
 * Note what the signatures do NOT take: a tenant id. Tenant scoping is
 * ambient (TenantContext) and applied by the adapter, so no use case can
 * forget it and no domain method has to know tenancy exists.
 */
export interface SampleItemRepository {
  save(item: SampleItem): Promise<void>;
  findById(id: string): Promise<SampleItem | null>;
  list(query: PageQuery): Promise<Page<SampleItem>>;
  countAll(): Promise<number>;
  delete(id: string): Promise<void>;
}

/** DI token — a symbol, so the port name cannot collide with anything. */
export const SAMPLE_ITEM_REPOSITORY = Symbol.for('anomalia.sample-feature.SampleItemRepository');
