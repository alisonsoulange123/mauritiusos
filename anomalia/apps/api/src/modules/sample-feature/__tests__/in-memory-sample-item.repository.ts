import type { Page, PageQuery } from '@anomalia/contracts';
import type { SampleItem } from '../domain/sample-item.entity.js';
import type { SampleItemRepository } from '../domain/sample-item.repository.js';

/**
 * The fake that makes the port worth having.
 *
 * Use-case tests run against this: no container, no migrations, no cleanup.
 * Because it satisfies the same interface the adapter does, a test that passes
 * here is exercising the real orchestration, not a mock's opinion of it.
 */
export class InMemorySampleItemRepository implements SampleItemRepository {
  readonly items = new Map<string, SampleItem>();

  async save(item: SampleItem): Promise<void> {
    this.items.set(item.id, item);
  }

  async findById(id: string): Promise<SampleItem | null> {
    return this.items.get(id) ?? null;
  }

  async list(query: PageQuery): Promise<Page<SampleItem>> {
    const sorted = [...this.items.values()].sort((a, b) => a.id.localeCompare(b.id));
    const start = query.cursor ? sorted.findIndex((item) => item.id > query.cursor!) : 0;
    const slice = sorted.slice(start, start + query.limit);
    const hasMore = start + query.limit < sorted.length;
    return { items: slice, nextCursor: hasMore ? (slice.at(-1)?.id ?? null) : null };
  }

  async countAll(): Promise<number> {
    return this.items.size;
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}
