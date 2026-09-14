import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IMMIGRATION_CONTRACT, eligibilityInputSchema } from '@reef-technologies/contracts';
import { ContractRegistry } from '../../../../core/contracts/contract-registry.js';
import { zodBody } from '../../../../core/http/zod-validation.pipe.js';
import { Roles } from '../../../../core/auth/auth.decorators.js';
import type { z } from 'zod';

/** `POST /immigration/check` from the API Contract Blueprint §9. */
@ApiTags('immigration')
@Controller('immigration')
export class ImmigrationController {
  constructor(private readonly contracts: ContractRegistry) {}

  @Post('check')
  @Roles('lead', 'client', 'advisor', 'admin')
  @ApiOperation({ summary: 'Evaluate permit eligibility for a profile' })
  async check(@Body(zodBody(eligibilityInputSchema)) body: z.infer<typeof eligibilityInputSchema>) {
    // Even its own controller goes through the contract, so the HTTP surface
    // and other modules exercise exactly the same code path.
    const immigration = this.contracts.get(IMMIGRATION_CONTRACT);
    const outcomes = await immigration.evaluate(body);
    return { outcomes };
  }
}
