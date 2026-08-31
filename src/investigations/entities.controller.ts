import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Permissions } from '../core/decorators/permissions.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { CreateEntityDto, CreateRelationshipDto } from './dto/entity.dto';
import { InvestigationsService } from './investigations.service';
@Controller('investigation-entities')
@Roles('admin', 'super_admin', 'investigator', 'staff')
export class EntitiesController {
  constructor(private readonly service: InvestigationsService) {}
  @Post() @Permissions('cases.update') create(
    @Body() d: CreateEntityDto,
    @CurrentUser() i: VerifiedIdentity,
  ) {
    return this.service.createEntity(d, i);
  }
  @Get('case/:caseId') @Permissions('cases.read') list(
    @Param('caseId', ParseUUIDPipe) c: string,
    @CurrentUser() i: VerifiedIdentity,
  ) {
    return this.service.entities(c, i);
  }
  @Post('relationships') @Permissions('cases.update') relate(
    @Body() d: CreateRelationshipDto,
    @CurrentUser() i: VerifiedIdentity,
  ) {
    return this.service.createRelationship(d, i);
  }
  @Get('case/:caseId/relationships') @Permissions('cases.read') relationships(
    @Param('caseId', ParseUUIDPipe) c: string,
    @CurrentUser() i: VerifiedIdentity,
  ) {
    return this.service.relationships(c, i);
  }
}
