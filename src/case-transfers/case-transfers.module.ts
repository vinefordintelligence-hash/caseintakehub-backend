import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaseTransfersService } from './case-transfers.service';
import { CaseTransfersController } from './case-transfers.controller';
import { CaseTransfer } from './entities/case-transfer.entity';
import { TransferDocumentRequirement } from './entities/transfer-document-requirement.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([CaseTransfer, TransferDocumentRequirement]),
  ],
  controllers: [CaseTransfersController],
  providers: [CaseTransfersService],
  exports: [CaseTransfersService],
})
export class CaseTransfersModule {}
