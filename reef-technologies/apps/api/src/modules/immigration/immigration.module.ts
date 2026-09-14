import { Module } from '@nestjs/common';
import { ImmigrationController } from './interface/http/immigration.controller.js';
import { ImmigrationContractImpl } from './application/immigration.contract-impl.js';

@Module({
  controllers: [ImmigrationController],
  providers: [ImmigrationContractImpl],
})
export class ImmigrationModule {}
