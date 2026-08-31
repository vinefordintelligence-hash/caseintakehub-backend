import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { CaseProgressController } from './case-progress.controller';
import { CaseProgressService } from './case-progress.service';
@Module({
  imports: [IdentityModule],
  controllers: [CaseProgressController],
  providers: [CaseProgressService],
  exports: [CaseProgressService],
})
export class CaseProgressModule {}
