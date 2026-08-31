import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { TimelineService } from './timeline.service';
import { CreateTimelineDto } from './dto/create-timeline.dto';
import { UpdateTimelineDto } from './dto/update-timeline.dto';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

@Controller('timeline')
@UseGuards(SupabaseIdentityGuard)
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  @Post()
  create(@Body() createTimelineDto: CreateTimelineDto, @Req() req: Request) {
    return this.timelineService.create(createTimelineDto, this.identity(req));
  }

  @Get()
  findAll(@Req() req: Request) {
    return this.timelineService.findAll(this.identity(req));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: Request) {
    return this.timelineService.findOne(id, this.identity(req));
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateTimelineDto: UpdateTimelineDto,
    @Req() req: Request,
  ) {
    return this.timelineService.update(
      id,
      updateTimelineDto,
      this.identity(req),
    );
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: Request) {
    return this.timelineService.remove(id, this.identity(req));
  }
  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
