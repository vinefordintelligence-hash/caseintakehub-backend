import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CaseTransfersService } from './case-transfers.service';
import { CreateCaseTransferDto } from './dto/create-case-transfer.dto';
import { SubmitForReviewDto } from './dto/submit-for-review.dto';
import { VerifyReceivingDetailsDto } from './dto/verify-receiving-details.dto';
import { AddDocumentRequirementDto } from './dto/add-document-requirement.dto';
import { SetRequirementStatusDto } from './dto/set-requirement-status.dto';
import { ExecuteTransferDto } from './dto/execute-transfer.dto';
import { UploadVerificationDocumentDto } from './dto/upload-verification-document.dto';
import { AdminReviewRequirementDto } from './dto/admin-review-requirement.dto';
import { Roles } from '../core/decorators/roles.decorator';
import { Permissions } from '../core/decorators/permissions.decorator';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

@ApiTags('case-transfers')
@Controller('case-transfers')
@Roles('admin', 'super_admin', 'investigator', 'staff')
export class CaseTransfersController {
  constructor(private readonly caseTransfersService: CaseTransfersService) {}

  @Post()
  @Permissions('cases.update')
  @ApiOperation({ summary: 'Phase 1 — prepare a transfer (status=prepared)' })
  create(@Body() dto: CreateCaseTransferDto, @Req() req: Request) {
    const identity = this.identity(req);
    return this.caseTransfersService.create(
      dto,
      identity.actorId,
      identity.organizationId,
    );
  }

  @Get()
  @Permissions('cases.read')
  @ApiQuery({ name: 'caseId', required: false })
  findAll(@Query('caseId') caseId?: string) {
    return this.caseTransfersService.findAll(caseId);
  }

  @Get(':id')
  @Permissions('cases.read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.caseTransfersService.findOne(id);
  }

  @Post(':id/review')
  @Permissions('cases.update')
  @ApiOperation({
    summary: 'Phase 2 — submit transfer for receiving-bank review',
  })
  submitForReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-actor-id') actorId: string,
    @Body() dto: SubmitForReviewDto,
  ) {
    return this.caseTransfersService.submitForReview(id, actorId, dto);
  }

  @Post(':id/verify-receiving-details')
  @Permissions('cases.update')
  @ApiOperation({
    summary:
      'Phase 3 — record bank acceptance / receiving-details verification (NOT execution)',
  })
  verifyReceivingDetails(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-actor-id') actorId: string,
    @Body() dto: VerifyReceivingDetailsDto,
  ) {
    return this.caseTransfersService.verifyReceivingDetails(id, actorId, dto);
  }

  @Post(':id/requirements')
  @Permissions('documents.verify')
  @ApiOperation({
    summary:
      'Phase 3 — request a verification document for the transfer (status=REQUIRED, audited)',
  })
  addRequirement(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-actor-id') actorId: string,
    @Body() dto: AddDocumentRequirementDto,
  ) {
    return this.caseTransfersService.addRequirement(id, actorId, dto);
  }

  @Post(':id/requirements/:requirementId/upload-document')
  @Permissions('documents.upload')
  @Roles('admin', 'super_admin', 'investigator', 'staff', 'client')
  @ApiOperation({
    summary:
      'CLIENT ACTION — upload the required verification document (status=SUBMITTED, audited)',
  })
  uploadVerificationDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requirementId', ParseUUIDPipe) requirementId: string,
    @Headers('x-actor-id') actorId: string,
    @Body() dto: UploadVerificationDocumentDto,
  ) {
    return this.caseTransfersService.uploadVerificationDocument(
      requirementId,
      actorId,
      dto,
    );
  }

  @Post(':id/requirements/:requirementId/status')
  @Permissions('documents.upload')
  @Roles('admin', 'super_admin', 'investigator', 'staff', 'client')
  @ApiOperation({
    summary:
      'Requirement lifecycle transition — SUBMITTED (client upload hand-off) or UNDER_REVIEW (admin begins review). VERIFIED/REJECTED/NEEDS_INFORMATION only via the admin review endpoint.',
  })
  setRequirementStatus(
    @Param('requirementId', ParseUUIDPipe) requirementId: string,
    @Headers('x-actor-id') actorId: string,
    @Body() dto: SetRequirementStatusDto,
  ) {
    return this.caseTransfersService.setRequirementStatus(
      requirementId,
      actorId,
      dto,
    );
  }

  @Get(':id/requirements')
  @Permissions('documents.read')
  @ApiOperation({
    summary:
      'List document requirements for a transfer (admin review queue — filter by ?status=under_review)',
  })
  @ApiQuery({ name: 'status', required: false })
  findRequirements(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('status') status?: string,
  ) {
    return this.caseTransfersService.findRequirements(id, status);
  }

  @Get(':id/requirements/:requirementId')
  @Permissions('documents.read')
  @ApiOperation({
    summary:
      'Requirement detail for admin review: document, upload timestamp, metadata, current status, configured verification info, and review history.',
  })
  @ApiQuery({ name: 'view', required: false, enum: ['admin', 'client'] })
  findRequirement(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requirementId', ParseUUIDPipe) requirementId: string,
    @Query('view') view?: 'admin' | 'client',
  ) {
    return this.caseTransfersService.findRequirement(
      requirementId,
      view ?? 'admin',
    );
  }

  @Post(':id/requirements/:requirementId/review')
  @Permissions('documents.verify')
  @ApiOperation({
    summary:
      'ADMIN REVIEW — approve / reject / request more information for the submitted document (audited). approve -> VERIFIED + PHASE 5; rejected/needs_information keep PHASE 5 locked.',
  })
  adminReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requirementId', ParseUUIDPipe) requirementId: string,
    @Headers('x-actor-id') actorId: string,
    @Body() dto: AdminReviewRequirementDto,
  ) {
    return this.caseTransfersService.adminReviewRequirement(
      requirementId,
      actorId,
      dto,
    );
  }

  @Post(':id/execute')
  @Permissions('cases.update')
  @ApiOperation({
    summary:
      'Execute transfer — LIVE mode + real confirmation reference only; demo/sandbox raises',
  })
  execute(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-actor-id') actorId: string,
    @Body() dto: ExecuteTransferDto,
  ) {
    return this.caseTransfersService.execute(id, actorId, dto);
  }

  private identity(req: Request): VerifiedIdentity {
    return (req as Request & { vfIdentity?: VerifiedIdentity }).vfIdentity!;
  }
}
