import { Module } from '@nestjs/common';
import { IntakesController } from './intakes.controller';
import { IntakesService } from './intakes.service';
import { CasesModule } from '../cases/cases.module';
import { NotificationsModule } from '../notifications/notifications.module';
@Module({
  imports: [CasesModule, NotificationsModule],
  controllers: [IntakesController],
  providers: [IntakesService],
})
export class IntakesModule {}
