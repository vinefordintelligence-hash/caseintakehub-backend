import { Module } from '@nestjs/common';
import { InvestigationsService } from './investigations.service';
import { InvestigationsController } from './investigations.controller';
import { EntitiesController } from './entities.controller';

@Module({
  controllers: [InvestigationsController, EntitiesController],
  providers: [InvestigationsService],
})
export class InvestigationsModule {}
