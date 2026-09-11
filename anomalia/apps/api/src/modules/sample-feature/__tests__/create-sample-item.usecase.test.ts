import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventBus, EventName } from '@anomalia/contracts';
import { CreateSampleItemUseCase } from '../application/create-sample-item.usecase.js';
import { InMemorySampleItemRepository } from './in-memory-sample-item.repository.js';
import { TenantContext } from '../../../core/tenancy/tenant-context.js';
import type { AuditService } from '../../../core/audit/audit.service.js';

const TENANT = '22222222-2222-2222-2222-222222222222';
const OWNER = '33333333-3333-3333-3333-333333333333';

describe('CreateSampleItemUseCase', () => {
  let repository: InMemorySampleItemRepository;
  let published: Array<{ name: EventName; payload: unknown }>;
  let useCase: CreateSampleItemUseCase;
  let tenantContext: TenantContext;
  const audit = { record: vi.fn() } as unknown as AuditService;

  beforeEach(() => {
    repository = new InMemorySampleItemRepository();
    published = [];
    tenantContext = new TenantContext();
    const bus: EventBus = {
      publish: async (name, payload) => {
        published.push({ name, payload });
      },
      subscribe: () => () => undefined,
    };
    useCase = new CreateSampleItemUseCase(repository, bus, tenantContext, audit);
  });

  const run = (title: string) =>
    tenantContext.run(
      { tenantId: TENANT, tenantSlug: 'mauritius', traceId: 'trace-1', roles: ['client'], locale: 'en' },
      () => useCase.execute({ title, ownerId: OWNER }),
    );

  it('persists the item and announces the fact', async () => {
    const item = await run('Book a bank appointment');

    expect(repository.items.size).toBe(1);
    expect(published).toHaveLength(1);
    expect(published[0]?.name).toBe('sample-feature.item.created');
    expect(published[0]?.payload).toMatchObject({ itemId: item.id, ownerId: OWNER });
  });

  it('stamps the ambient tenant onto the item', async () => {
    const item = await run('Register with the tax office');
    expect(item.snapshot().tenantId).toBe(TENANT);
  });

  it('refuses to run with no tenant in scope', async () => {
    // The guarantee that matters: a query can never accidentally run
    // un-scoped and read another tenant's rows.
    await expect(useCase.execute({ title: 'Orphan item', ownerId: OWNER })).rejects.toThrow(
      /No tenant in scope/,
    );
  });

  it('publishes nothing when the domain rejects the input', async () => {
    await expect(run('ab')).rejects.toThrow(/at least 3 characters/);
    expect(published).toHaveLength(0);
    expect(repository.items.size).toBe(0);
  });
});
