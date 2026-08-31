import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  DocumentRequestsService,
  CreateDocumentRequestInput,
  SubmitDocumentRequestInput,
  ReviewDocumentRequestInput,
} from './document-requests.service';

@ApiTags('document-requests')
@Controller('document-requests')
@UseGuards(SupabaseIdentityGuard)
export class DocumentRequestsController {
  constructor(
    private readonly documentRequestsService: DocumentRequestsService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List document requests — client role requires a case context and only sees its own case; admin is organization-scoped',
  })
  findAll(
    @Query('case_id') caseId?: string,
    @Query('caseId') caseIdAlt?: string,
    @Query('view') view?: string,
    @Headers('x-actor-id') actorId?: string,
  ) {
    const caseContext = caseId ?? caseIdAlt;
    return this.documentRequestsService.findAll(
      actorId ?? '',
      caseContext,
      view === 'client' ? 'client' : 'admin',
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a document request (administrators only)' })
  create(
    @Body() body: CreateDocumentRequestInput,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.documentRequestsService.create(actorId ?? '', {
      caseId: body.caseId,
      title: body.title,
      description: body.description ?? null,
      deadline: body.deadline ?? null,
      isClientVisible: body.isClientVisible ?? true,
    });
  }

  @Post(':id/upload')
  @ApiOperation({
    summary:
      'Submit a document against a request — authorized client (or admin) uploads file metadata',
  })
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SubmitDocumentRequestInput,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.documentRequestsService.submit(actorId ?? '', id, {
      title: body.title ?? null,
      file_name: body.file_name,
      file_size: body.file_size ?? null,
      file_type: body.file_type ?? null,
    });
  }

  @Patch(':id/review')
  @ApiOperation({
    summary:
      'Approve or reject a submitted document request (administrators only)',
  })
  review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReviewDocumentRequestInput,
    @Headers('x-actor-id') actorId?: string,
  ) {
    return this.documentRequestsService.review(actorId ?? '', id, {
      status: body.status === 'approved' ? 'approved' : 'rejected',
      note: body.note ?? null,
    });
  }
}
