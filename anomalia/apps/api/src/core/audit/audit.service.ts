import { Inject, Injectable, Logger } from '@nestjs/common';
import { DATABASE, type DatabaseRef } from '../database/database.tokens.js';
import { auditLog } from '../database/core.schema.js';
import { TenantContext } from '../tenancy/tenant-context.js';

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
