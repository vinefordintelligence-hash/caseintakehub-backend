import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { CommunicationsService } from './communications.service';
import { CreateCommunicationDto } from './dto/create-communication.dto';
import { UpdateCommunicationDto } from './dto/update-communication.dto';
import { Roles } from '../core/decorators/roles.decorator';

@Controller('communications')
@Roles('admin', 'super_admin', 'investigator', 'staff')
export class CommunicationsController {
  constructor(private readonly communicationsService: CommunicationsService) {}

  @Post()
  create(@Body() createCommunicationDto: CreateCommunicationDto) {
    return this.communicationsService.create(createCommunicationDto);
  }

  @Get()
  findAll() {
    return this.communicationsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.communicationsService.findOne(+id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateCommunicationDto: UpdateCommunicationDto,
  ) {
    return this.communicationsService.update(+id, updateCommunicationDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.communicationsService.remove(+id);
  }
}
