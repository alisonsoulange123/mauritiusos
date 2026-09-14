import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Page } from '@anomalia/contracts';
import { DATABASE, type DatabaseRef } from '../database/database.tokens.js';
import { auditLog } from '../database/core.schema.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { decodeTimeCursor, encodeTimeCursor } from '../http/cursor.js';

export interface AuditQuery {
  action?: string;
  result?: 'success' | 'denied' | 'error';
  actorId?: string;
  resourceId?: string;
  cursor?: string;
  limit: number;
}

export interface AuditRecord {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: 'success' | 'denied' | 'error';
  traceId: string;
  metadata: Record<string, unknown>;
  occurredAt: Date;
}

export interface AuditEntry {
  action: string;
  resourceType: string;
  resourceId?: string;
  result?: 'success' | 'denied' | 'error';
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit trail (Security blueprint §13).
 *
 * Every access to Restricted data — passport scans, financial documents, role
 * changes — must land here. Two design choices worth noting:
 *
 *  • Writes never throw. A failed audit insert must not fail the user's
 *    request; it is logged at error level and alerted on instead. Losing an
 *    audit row is bad, but refusing a legitimate document download because the
 *    audit table is full is worse.
 *  • The actor and trace come from the ambient scope, not from arguments, so a
 *    caller cannot misattribute an action to another user.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseRef,
    private readonly tenantContext: TenantContext,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    const scope = this.tenantContext.current();
    try {
      await this.database.db.insert(auditLog).values(this.toRow(entry, scope));
    } catch (error) {
      this.logger.error(
        `AUDIT WRITE FAILED action=${entry.action} resource=${entry.resourceType}:${entry.resourceId} trace=${scope?.traceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Reads the trail back, newest first.
   *
   * The write path is append-only and this is the only read path, which keeps
   * the "append-only" claim true in code rather than only in the comment
   * above: nothing here updates or deletes.
   *
   * `action` matches on a prefix, so `identity.` narrows to one bounded
   * context and `identity.role.` to one kind of decision — which is how an
   * operator actually searches, rather than by knowing the exact string.
   */
  async query(query: AuditQuery): Promise<Page<AuditRecord>> {
    const tenantId = this.tenantContext.requireTenantId();
    const cursor = decodeTimeCursor(query.cursor);

    const filters: Array<SQL | undefined> = [
      eq(auditLog.tenantId, tenantId),
      query.action ? sql`${auditLog.action} like ${`${query.action}%`}` : undefined,
      query.result ? eq(auditLog.result, query.result) : undefined,
      query.actorId ? eq(auditLog.actorId, query.actorId) : undefined,
      query.resourceId ? eq(auditLog.resourceId, query.resourceId) : undefined,
      cursor
        ? sql`(${auditLog.occurredAt}, ${auditLog.id}) < (${cursor.at.toISOString()}::timestamptz, ${cursor.id}::uuid)`
        : undefined,
    ];

    const rows = await this.database.db
      .select()
      .from(auditLog)
      .where(and(...filters.filter((filter): filter is SQL => filter !== undefined)))
      .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => ({
        id: row.id,
        actorId: row.actorId,
        actorRole: row.actorRole,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        result: row.result,
        traceId: row.traceId,
        metadata: row.metadata,
        occurredAt: row.occurredAt,
      })),
      nextCursor: hasMore && last ? encodeTimeCursor(last.occurredAt, last.id) : null,
    };
  }

  /** Projects the entry plus the ambient scope onto the table's columns. */
  private toRow(entry: AuditEntry, scope: ReturnType<TenantContext['current']>) {
    return {
      tenantId: scope?.tenantId ?? null,
      actorId: scope?.actorId ?? null,
      actorRole: scope?.roles[0] ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      result: entry.result ?? 'success',
      traceId: scope?.traceId ?? 'unknown',
      metadata: entry.metadata ?? {},
    };
  }
}
