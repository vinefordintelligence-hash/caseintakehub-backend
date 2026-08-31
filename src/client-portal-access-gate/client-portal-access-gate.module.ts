import { Global, Module } from '@nestjs/common';
import { ClientPortalAccessGateGuard } from './client-portal-access-gate.guard';
import { ClientPortalAccessGateService } from './client-portal-access-gate.service';

@Global()
@Module({
  providers: [ClientPortalAccessGateService, ClientPortalAccessGateGuard],
  exports: [ClientPortalAccessGateService, ClientPortalAccessGateGuard],
})
export class ClientPortalAccessGateModule {}
