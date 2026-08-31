import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Permissions } from '../core/decorators/permissions.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { SearchLookupDto } from './dto/search-lookup.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchService } from './search.service';

@Controller('search')
@Roles('admin', 'super_admin', 'investigator', 'financial_analyst', 'staff')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @Permissions('cases.read')
  search(
    @Query() query: SearchQueryDto,
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    return this.searchService.search(query, identity);
  }

  @Get(':id')
  @Permissions('cases.read')
  lookup(
    @Param() params: SearchLookupDto,
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    return this.searchService.lookup(params.id, identity);
  }

  // Legacy saved-search routes remain addressable, but are deliberately disabled
  // until a persisted, organization-scoped saved-search model exists.
  @Post()
  @Permissions('cases.read')
  create() {
    return this.searchService.create();
  }

  @Patch(':id')
  @Permissions('cases.read')
  update() {
    return this.searchService.update();
  }

  @Delete(':id')
  @Permissions('cases.read')
  remove() {
    return this.searchService.remove();
  }
}
