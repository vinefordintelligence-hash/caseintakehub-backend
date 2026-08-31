import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../core/decorators/current-user.decorator';
import { Roles } from '../core/decorators/roles.decorator';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

@Controller('tasks')
@Roles('admin', 'super_admin', 'investigator', 'staff', 'client')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}
  @Post() create(
    @Body() dto: CreateTaskDto,
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    return this.tasksService.create(dto, identity);
  }
  @Get() findAll(@CurrentUser() identity: VerifiedIdentity) {
    return this.tasksService.findAll(identity);
  }
  @Get(':id') findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    return this.tasksService.findOne(id, identity);
  }
  @Patch(':id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    return this.tasksService.update(id, dto, identity);
  }
  @Delete(':id') remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() identity: VerifiedIdentity,
  ) {
    return this.tasksService.remove(id, identity);
  }
}
