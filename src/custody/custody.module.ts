import { Module } from '@nestjs/common';
import { CustodyController } from './custody.controller';
import { CustodyService } from './custody.service';
@Module({ controllers: [CustodyController], providers: [CustodyService] })
export class CustodyModule {}
