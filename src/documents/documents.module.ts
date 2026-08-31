import { Module } from '@nestjs/common';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { IdentityModule } from '../identity/identity.module';
import { PermissionsModule } from '../permissions/permissions.module';

@Module({
  imports: [IdentityModule, PermissionsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
