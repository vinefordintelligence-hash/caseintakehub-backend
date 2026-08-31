import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CasesService } from './cases.service';
import { CasesController } from './cases.controller';
import { Case } from './entities/case.entity';
import { IdentityModule } from '../identity/identity.module';
import { CaseReferenceService } from './case-reference.service';

@Module({
  imports: [TypeOrmModule.forFeature([Case]), IdentityModule],
  controllers: [CasesController],
  providers: [CasesService, CaseReferenceService],
  exports: [CasesService, CaseReferenceService],
})
export class CasesModule {}
