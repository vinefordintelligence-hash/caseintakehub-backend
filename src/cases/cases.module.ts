import { Module } from '@nestjs/common';
import { CasesService } from './cases.service';
import { CasesController } from './cases.controller';

@Module({
  controllers: [CasesController],
  providers: [CasesService],
})
export class CasesModule {}
