import { Module } from '@nestjs/common';
import { DocumentRequestsService } from './document-requests.service';
import { DocumentRequestsController } from './document-requests.controller';

@Module({
  controllers: [DocumentRequestsController],
  providers: [DocumentRequestsService],
})
export class DocumentRequestsModule {}
