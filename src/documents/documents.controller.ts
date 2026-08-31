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
  ParseUUIDPipe,
} from '@nestjs/common';
import { Request } from 'express';
import { DocumentsService } from './documents.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { Permissions } from '../core/decorators/permissions.decorator';

@Controller('documents')
@UseGuards(SupabaseIdentityGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post()
  @Permissions('documents.upload')
  create(@Body() createDocumentDto: CreateDocumentDto, @Req() req: Request) {
    return this.documentsService.create(createDocumentDto, this.identity(req));
  }

  @Get()
  @Permissions('documents.read')
  findAll(@Req() req: Request) {
    return this.documentsService.findAll(this.identity(req));
  }

  @Get(':id')
  @Permissions('documents.read')
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.documentsService.findOne(id, this.identity(req));
  }

  @Patch(':id')
  @Permissions('documents.upload')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDocumentDto: UpdateDocumentDto,
    @Req() req: Request,
  ) {
    return this.documentsService.update(
      id,
      updateDocumentDto,
      this.identity(req),
    );
  }

  @Delete(':id')
  @Permissions('documents.verify')
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.documentsService.remove(id, this.identity(req));
  }
  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
