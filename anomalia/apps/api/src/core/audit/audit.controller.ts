import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Page } from '@anomalia/contracts';
import { Roles } from '../auth/auth.decorators.js';
import { zodBody } from '../http/zod-validation.pipe.js';
import { AuditService, type AuditRecord } from './audit.service.js';

const auditQuerySchema = z.object({
  /** Prefix match: `identity.` narrows to a context, `identity.role.` to a kind. */
  action: z.string().max(80).optional(),
  result: z.enum(['success', 'denied', 'error']).optional(),
  actorId: z.string().uuid().optional(),
  resourceId: z.string().max(80).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Read access to the audit trail.
 *
 * `admin` only, and not by oversight: these rows are a record of what everyone
 * in the tenant did, including the advisors who would otherwise be the obvious
 * second audience. An advisor needs to manage their own customers, not to read
 * their colleagues' actions.
 *
 * It lives in core because core owns the table. A module that wanted this
 * would be reading another context's storage, which the boundary guard exists
 * to prevent.
 */
@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Roles('admin')
  @Get()
  @ApiOperation({ summary: 'Query the audit trail (cursor paginated, newest first)' })
  async list(
    @Query(zodBody(auditQuerySchema)) query: z.infer<typeof auditQuerySchema>,
  ): Promise<Page<AuditRecord>> {
    return this.audit.query(query);
  }
}
