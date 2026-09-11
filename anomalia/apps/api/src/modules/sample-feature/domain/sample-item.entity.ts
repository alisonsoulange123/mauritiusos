import { DomainError } from '@anomalia/contracts';

export type SampleItemStatus = 'draft' | 'active' | 'archived';

export interface SampleItemProps {
  id: string;
  tenantId: string;
  ownerId: string;
  title: string;
  notes: string | null;
  status: SampleItemStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A domain ENTITY: business rules, no framework, no SQL, no HTTP.
 *
 * Why bother when the table has five columns? Because invariants belong
 * somewhere that cannot be bypassed. `create()` is the only way to make one
 * and it enforces the title rule; `archive()` is the only way to archive and
 * it enforces the state machine. A use case, a background job and a CLI script
 * all get the same guarantees without repeating a single check.
 *
 * This file must stay importable with no database and no Nest container — that
 * is what makes the rules testable in microseconds, and the boundary linter
 * fails the build if anyone imports `@nestjs/*` or `drizzle-orm` in here.
 */
export class SampleItem {
  private constructor(private props: SampleItemProps) {}

  static readonly MAX_TITLE_LENGTH = 140;

  /** The only construction path for a NEW item. */
  static create(input: {
    id: string;
    tenantId: string;
    ownerId: string;
    title: string;
    notes?: string | null;
  }): SampleItem {
    const title = input.title.trim();

    if (title.length < 3) {
      throw new DomainError('SAMPLE_TITLE_TOO_SHORT', 'A title needs at least 3 characters.', 422);
    }
    if (title.length > SampleItem.MAX_TITLE_LENGTH) {
      throw new DomainError(
        'SAMPLE_TITLE_TOO_LONG',
        `A title may not exceed ${SampleItem.MAX_TITLE_LENGTH} characters.`,
        422,
      );
    }

    const now = new Date();
    return new SampleItem({
      id: input.id,
      tenantId: input.tenantId,
      ownerId: input.ownerId,
      title,
      notes: input.notes?.trim() || null,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Rehydration from persistence — skips creation rules by design. */
  static fromPersistence(props: SampleItemProps): SampleItem {
    return new SampleItem(props);
  }

  activate(): void {
    if (this.props.status === 'archived') {
      throw new DomainError('SAMPLE_ALREADY_ARCHIVED', 'An archived item cannot be reactivated.', 409);
    }
    this.props.status = 'active';
    this.props.updatedAt = new Date();
  }

  archive(): void {
    if (this.props.status === 'draft') {
      throw new DomainError('SAMPLE_DRAFT_NOT_ARCHIVABLE', 'Activate the item before archiving it.', 409);
    }
    this.props.status = 'archived';
    this.props.updatedAt = new Date();
  }

  rename(title: string): void {
    const next = title.trim();
    if (next.length < 3 || next.length > SampleItem.MAX_TITLE_LENGTH) {
      throw new DomainError('SAMPLE_TITLE_INVALID', 'Title must be 3–140 characters.', 422);
    }
    this.props.title = next;
    this.props.updatedAt = new Date();
  }

  /** Ownership check as a domain rule, not an ad-hoc `if` in a controller. */
  isOwnedBy(userId: string): boolean {
    return this.props.ownerId === userId;
  }

  get id(): string { return this.props.id; }
  get tenantId(): string { return this.props.tenantId; }
  get ownerId(): string { return this.props.ownerId; }
  get title(): string { return this.props.title; }
  get status(): SampleItemStatus { return this.props.status; }

  /** Read-only snapshot for repositories and serializers. */
  snapshot(): Readonly<SampleItemProps> {
    return { ...this.props };
  }
}
