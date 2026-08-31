import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CreateCaseDto } from './dto/create-case.dto';
import { UpdateCaseDto } from './dto/update-case.dto';
import { Case } from './entities/case.entity';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { CaseReferenceService } from './case-reference.service';

@Injectable()
export class CasesService {
  constructor(
    @InjectRepository(Case)
    private readonly caseRepository: Repository<Case>,
    private readonly caseReferences: CaseReferenceService,
  ) {}

  private staff(identity: VerifiedIdentity): void {
    if (identity.role === 'client')
      throw new ForbiddenException('client cannot modify cases');
  }

  private scope(identity: VerifiedIdentity, id?: string) {
    const where: { organizationId: string; id?: string } = {
      organizationId: identity.organizationId,
    };
    if (identity.role === 'client') where.id = identity.caseId;
    else if (id) where.id = id;
    return where;
  }

  async create(
    createCaseDto: CreateCaseDto,
    identity: VerifiedIdentity,
  ): Promise<Case> {
    this.staff(identity);
    const clients = await this.caseRepository.query(
      'SELECT id FROM public.clients WHERE id=$1 AND organization_id=$2',
      [createCaseDto.client_id, identity.organizationId],
    );
    if (!clients[0]) throw new NotFoundException('client not found');
    if (createCaseDto.assigned_to) {
      const assignees = await this.caseRepository.query(
        `SELECT id FROM public.app_users WHERE id=$1 AND organization_id=$2 AND is_active=true AND role<>'client'`,
        [createCaseDto.assigned_to, identity.organizationId],
      );
      if (!assignees[0]) throw new NotFoundException('assignee not found');
    }
    const saved = await this.caseReferences.create(async (caseNumber) => {
      const newCase = this.caseRepository.create({
        title: createCaseDto.title.trim(),
        description: createCaseDto.description?.trim(),
        clientId: createCaseDto.client_id,
        assignedTo: createCaseDto.assigned_to,
        organizationId: identity.organizationId,
        caseNumber,
        status: 'open',
        workflowPhase: 'transfer_preparation',
        workflowPhaseNumber: 1,
      });
      return this.caseRepository.save(newCase);
    });
    await this.audit(saved.id, identity, 'CASE_CREATED', {
      case_number: saved.caseNumber,
    });
    return saved;
  }

  async findAll(identity: VerifiedIdentity): Promise<Case[]> {
    return this.caseRepository.find({
      where: this.scope(identity),
      order: {
        createdAt: 'DESC',
      },
    });
  }

  async findOne(id: string, identity: VerifiedIdentity): Promise<Case> {
    const foundCase = await this.caseRepository.findOne({
      where: this.scope(identity, id),
    });

    if (!foundCase) {
      throw new NotFoundException(`Case with ID ${id} not found`);
    }

    return foundCase;
  }

  async update(
    id: string,
    updateCaseDto: UpdateCaseDto,
    identity: VerifiedIdentity,
  ): Promise<Case> {
    this.staff(identity);
    await this.assertNotHeld(id, identity);
    const foundCase = await this.findOne(id, identity);

    if (updateCaseDto.assigned_to) {
      const assignees = await this.caseRepository.query(
        `SELECT id FROM public.app_users WHERE id=$1 AND organization_id=$2 AND is_active=true AND role<>'client'`,
        [updateCaseDto.assigned_to, identity.organizationId],
      );
      if (!assignees[0]) throw new NotFoundException('assignee not found');
    }
    if (updateCaseDto.title !== undefined)
      foundCase.title = updateCaseDto.title.trim();
    if (updateCaseDto.description !== undefined)
      foundCase.description = updateCaseDto.description.trim();
    if (updateCaseDto.assigned_to !== undefined)
      foundCase.assignedTo = updateCaseDto.assigned_to;

    const saved = await this.caseRepository.save(foundCase);
    await this.audit(id, identity, 'CASE_UPDATED', {
      fields: Object.keys(updateCaseDto).filter(
        (key) => !['organization_id', 'client_id', 'case_number'].includes(key),
      ),
    });
    return saved;
  }

  async close(
    id: string,
    reason: string | undefined,
    identity: VerifiedIdentity,
  ): Promise<Record<string, unknown>> {
    this.staff(identity);
    await this.findOne(id, identity);
    await this.assertNotHeld(id, identity);
    const rows = await this.caseRepository.query(
      `UPDATE public.cases SET status='closed',updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,case_number,status,updated_at`,
      [id, identity.organizationId],
    );
    await this.audit(id, identity, 'CASE_CLOSED', {
      reason: reason?.trim() || null,
    });
    return rows[0];
  }

  async archive(
    id: string,
    reason: string | undefined,
    identity: VerifiedIdentity,
  ): Promise<Record<string, unknown>> {
    this.staff(identity);
    await this.findOne(id, identity);
    await this.assertNotHeld(id, identity);
    const rows = await this.caseRepository.query(
      `UPDATE public.cases SET status='archived',updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,case_number,status,updated_at`,
      [id, identity.organizationId],
    );
    await this.audit(id, identity, 'CASE_ARCHIVED', {
      reason: reason?.trim() || null,
    });
    return rows[0];
  }

  async remove(
    id: string,
    identity: VerifiedIdentity,
  ): Promise<Record<string, unknown>> {
    return this.archive(
      id,
      'Archived through legacy DELETE compatibility route',
      identity,
    );
  }

  private async assertNotHeld(
    id: string,
    identity: VerifiedIdentity,
  ): Promise<void> {
    const hold = await this.caseRepository.query<
      Array<{ legal_hold: boolean }>
    >(
      'SELECT legal_hold FROM public.cases WHERE id = $1 AND organization_id = $2',
      [id, identity.organizationId],
    );
    if (hold[0]?.legal_hold)
      throw new ConflictException(
        'case is under legal hold and cannot be modified',
      );
  }

  private async audit(
    caseId: string,
    identity: VerifiedIdentity,
    action: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    await this.caseRepository.query(
      `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,case_id,changes)
       VALUES($1,$2,$3,'case',$4,$4,$5::jsonb)`,
      [
        identity.organizationId,
        identity.actorId,
        action,
        caseId,
        JSON.stringify(changes),
      ],
    );
  }
}
