import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { CaseAssignmentsController } from './case-assignments.controller';
import { CaseAssignmentsService } from './case-assignments.service';

@Module({
  imports: [IdentityModule],
  controllers: [CaseAssignmentsController],
  providers: [CaseAssignmentsService],
})
export class CaseAssignmentsModule {}
