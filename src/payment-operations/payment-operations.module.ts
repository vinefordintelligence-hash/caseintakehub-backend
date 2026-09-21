import { Module } from '@nestjs/common';
import { WorkflowEngineModule } from '../workflow-engine/workflow-engine.module';
import { FeeConfigurationModule } from '../fee-configuration/fee-configuration.module';
import { PaymentOperationsController } from './payment-operations.controller';
import { PaymentOperationsService } from './payment-operations.service';

@Module({
  imports: [WorkflowEngineModule, FeeConfigurationModule],
  controllers: [PaymentOperationsController],
  providers: [PaymentOperationsService],
  exports: [PaymentOperationsService],
})
export class PaymentOperationsModule {}
