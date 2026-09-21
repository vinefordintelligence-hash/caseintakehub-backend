import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeeDefinition } from './fee-definition.entity';
import { FeeComponent } from './fee-component.entity';
import { FeeSnapshot } from './fee-snapshot.entity';
import { FeeConfigurationService } from './fee-configuration.service';
import { FeeConfigurationController } from './fee-configuration.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([FeeDefinition, FeeComponent, FeeSnapshot]),
  ],
  providers: [FeeConfigurationService],
  controllers: [FeeConfigurationController],
  exports: [FeeConfigurationService],
})
export class FeeConfigurationModule {}
