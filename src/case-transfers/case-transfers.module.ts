import { Module } from '@nestjs/common';
import { CaseTransfersService } from './case-transfers.service';
import { CaseTransfersController } from './case-transfers.controller';

@Module({
  controllers: [CaseTransfersController],
  providers: [CaseTransfersService],
})
export class CaseTransfersModule {}
