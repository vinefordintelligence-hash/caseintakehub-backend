import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import {
  CreateIntakeDto,
  ResumeIntakeDto,
  ReviewIntakeDto,
  SubmitPublicIntakeDto,
  UpdateIntakeDraftDto,
} from './dto/intake.dto';
import { CaseReferenceService } from '../cases/case-reference.service';
import { ActivityNotificationService } from '../notifications/activity-notification.service';

@Injectable()
export class IntakesService {
  constructor(
    @InjectDataSource() private readonly data: DataSource,
    private readonly caseReferences: CaseReferenceService,
    @Optional() private readonly notifications?: ActivityNotificationService,
  ) {}
  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  async create(dto: CreateIntakeDto) {
    const org = await this.data.query(
      `SELECT id FROM public.organizations WHERE id=$1`,
      [dto.organization_id],
    );
    if (!org[0]) throw new NotFoundException('organization not available');
    const token = randomBytes(32).toString('base64url');
    const rows = await this.data.query(
      `INSERT INTO public.case_intakes(organization_id,email,category,incident_description,urgency,draft_token_hash)
      VALUES($1,lower($2),$3,$4,$5,$6) RETURNING id,status,created_at,updated_at`,
      [
        dto.organization_id,
        dto.email.trim(),
        dto.category?.trim() || null,
        dto.incident_description?.trim() || null,
        dto.urgency ?? null,
        this.hash(token),
      ],
    );
    return { ...rows[0], resumeToken: token };
  }

  async publicSubmit(dto: SubmitPublicIntakeDto) {
    const organizations = await this.data.query(
      `SELECT id FROM public.organizations WHERE slug='vineford' ORDER BY created_at LIMIT 1`,
    );
    if (!organizations[0])
      throw new NotFoundException(
        'public intake organization is not configured',
      );
    const services = dto.services
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 20);
    if (!services.length)
      throw new ConflictException(
        'at least one assessment service is required',
      );
    const metadata = {
      applicant: {
        first_name: dto.first_name.trim(),
        last_name: dto.last_name.trim(),
        phone: dto.phone?.trim() || null,
        country: dto.country.trim(),
        company: dto.company?.trim() || null,
      },
      answers: {
        role: dto.role?.trim() || null,
        existing_client: dto.existing_client?.trim() || null,
        financial_loss: dto.financial_loss?.trim() || null,
        contact_method: dto.contact_method?.trim() || null,
        existing_case_reference: dto.existing_case_reference?.trim() || null,
        ...(dto.assessment_answers ?? {}),
      },
      services,
      source: 'public_assessment_gateway',
    };
    const rows = await this.data.query(
      `INSERT INTO public.case_intakes(organization_id,email,category,incident_description,urgency,status,metadata,submitted_at)
      VALUES($1,lower($2),$3,$4,$5,'submitted',$6::jsonb,now()) RETURNING id,status,submitted_at`,
      [
        organizations[0].id,
        dto.email.trim(),
        services.join(', '),
        dto.situation?.trim() || null,
        dto.urgency ?? 'normal',
        JSON.stringify(metadata),
      ],
    );
    void this.notifications
      ?.enqueue({
        eventKey: `intake.submitted:${rows[0].id}`,
        eventType: 'intake.submitted',
        category: 'intake',
        organizationId: organizations[0].id,
        actorType: 'public_client',
        actorName: `${dto.first_name.trim()} ${dto.last_name.trim()}`.trim(),
        entityType: 'case_intake',
        entityId: rows[0].id,
        entityReference: `INT-${String(rows[0].id).slice(0, 8).toUpperCase()}`,
        title: 'New Assessment Submitted',
        description: 'A new client assessment has been submitted.',
        status: rows[0].status,
        occurredAt: new Date(rows[0].submitted_at),
      })
      .catch(() => undefined);
    return {
      intake_id: rows[0].id,
      reference: `INT-${String(rows[0].id).slice(0, 8).toUpperCase()}`,
      status: rows[0].status,
      submitted_at: rows[0].submitted_at,
    };
  }

  async resume(dto: ResumeIntakeDto) {
    const rows = await this.data.query(
      `SELECT id,status,category,incident_description,urgency,created_at,updated_at FROM public.case_intakes WHERE id=$1 AND draft_token_hash=$2 AND status='draft'`,
      [dto.intake_id, this.hash(dto.token)],
    );
    if (!rows[0]) throw new NotFoundException('intake draft not found');
    return rows[0];
  }

  async update(dto: UpdateIntakeDraftDto) {
    await this.resume(dto);
    const rows = await this.data.query(
      `UPDATE public.case_intakes SET category=COALESCE($1,category),incident_description=COALESCE($2,incident_description),urgency=COALESCE($3,urgency),updated_at=now() WHERE id=$4 AND draft_token_hash=$5 AND status='draft' RETURNING id,status,updated_at`,
      [
        dto.category?.trim() || null,
        dto.incident_description?.trim() || null,
        dto.urgency ?? null,
        dto.intake_id,
        this.hash(dto.token),
      ],
    );
    return rows[0];
  }

  async submit(dto: ResumeIntakeDto) {
    await this.resume(dto);
    const rows = await this.data.query(
      `UPDATE public.case_intakes SET status='submitted',submitted_at=now(),draft_token_hash=NULL,updated_at=now() WHERE id=$1 AND draft_token_hash=$2 RETURNING id,status,submitted_at`,
      [dto.intake_id, this.hash(dto.token)],
    );
    return rows[0];
  }

  list(identity: VerifiedIdentity) {
    this.assertStaff(identity);
    return this.data.query(
      `SELECT i.id,concat('INT-',upper(left(i.id::text,8))) reference_id,
      concat_ws(' ',i.metadata->'applicant'->>'first_name',i.metadata->'applicant'->>'last_name') applicant_name,
      i.email,i.metadata->'applicant'->>'phone' phone,i.category,i.incident_description,i.urgency,i.status,
      i.submitted_at,i.reviewed_at,i.converted_case_id,i.created_at,i.updated_at,o.name organization,
      reviewer.name assigned_reviewer,0::int attachment_count
      FROM public.case_intakes i JOIN public.organizations o ON o.id=i.organization_id
      LEFT JOIN public.app_users reviewer ON reviewer.id=nullif(i.metadata->>'reviewed_by','')::uuid
      WHERE i.organization_id=$1 ORDER BY coalesce(i.submitted_at,i.created_at) DESC`,
      [identity.organizationId],
    );
  }

  async detail(id: string, identity: VerifiedIdentity) {
    this.assertStaff(identity);
    const rows = await this.data.query(
      `SELECT i.*,concat('INT-',upper(left(i.id::text,8))) reference_id,o.name organization,
      reviewer.name assigned_reviewer,converter.case_number converted_case_number,0::int attachment_count,'[]'::jsonb attachments,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('action',a.action,'actor',u.name,'changes',a.changes,'created_at',a.created_at) ORDER BY a.created_at),'[]'::jsonb)
         FROM public.audit_logs a LEFT JOIN public.app_users u ON u.id=a.user_id WHERE a.resource_type='case_intake' AND a.resource_id=i.id) audit_history
      FROM public.case_intakes i JOIN public.organizations o ON o.id=i.organization_id
      LEFT JOIN public.app_users reviewer ON reviewer.id=nullif(i.metadata->>'reviewed_by','')::uuid
      LEFT JOIN public.cases converter ON converter.id=i.converted_case_id
      WHERE i.id=$1 AND i.organization_id=$2`,
      [id, identity.organizationId],
    );
    if (!rows[0]) throw new NotFoundException('intake not found');
    return rows[0];
  }

  async review(id: string, dto: ReviewIntakeDto, identity: VerifiedIdentity) {
    if (!['admin', 'super_admin'].includes(identity.role))
      throw new ForbiddenException('administrator access required');
    const rows = await this.data.query(
      `UPDATE public.case_intakes SET status=$1,reviewed_at=now(),updated_at=now(),metadata=metadata||jsonb_build_object('review_reason',$2::text,'reviewed_by',$3::text) WHERE id=$4 AND organization_id=$5 AND status IN ('submitted','under_review','accepted') RETURNING id,status,reviewed_at`,
      [
        dto.status,
        dto.reason?.trim() || null,
        identity.actorId,
        id,
        identity.organizationId,
      ],
    );
    if (!rows[0]) throw new NotFoundException('reviewable intake not found');
    await this.data.query(
      `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,changes) VALUES($1,$2,'INTAKE_REVIEWED','case_intake',$3,$4)`,
      [
        identity.organizationId,
        identity.actorId,
        id,
        JSON.stringify({ status: dto.status, reason: dto.reason ?? null }),
      ],
    );
    return rows[0];
  }

  async convert(id: string, identity: VerifiedIdentity) {
    if (!['admin', 'super_admin'].includes(identity.role))
      throw new ForbiddenException('administrator access required');
    const runner = this.data.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const intakes = await runner.query(
        `SELECT * FROM public.case_intakes WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [id, identity.organizationId],
      );
      const intake = intakes[0];
      if (!intake) throw new NotFoundException('intake not found');
      if (intake.status === 'converted')
        throw new ConflictException('intake has already been converted');
      if (intake.status !== 'accepted')
        throw new ConflictException('only an accepted intake can be converted');
      const applicant = intake.metadata?.applicant ?? {};
      const existing = await runner.query(
        `SELECT id FROM public.clients WHERE organization_id=$1 AND lower(email)=lower($2) ORDER BY created_at LIMIT 1`,
        [identity.organizationId, intake.email],
      );
      let clientId = existing[0]?.id;
      if (!clientId) {
        const clients = await runner.query(
          `INSERT INTO public.clients(organization_id,name,email,phone,country) VALUES($1,$2,lower($3),$4,$5) RETURNING id`,
          [
            identity.organizationId,
            `${applicant.first_name ?? ''} ${applicant.last_name ?? ''}`.trim() ||
              intake.email,
            intake.email,
            applicant.phone ?? null,
            applicant.country ?? null,
          ],
        );
        clientId = clients[0].id;
      }
      const actorRows = await runner.query(
        `SELECT id,organization_id,role::text,is_active
           FROM public.app_users
          WHERE lower(email)=lower($1)
          ORDER BY created_at ASC
          LIMIT 1`,
        [intake.email],
      );
      let clientActorId = actorRows[0]?.id;
      if (actorRows[0]) {
        if (
          actorRows[0].organization_id !== identity.organizationId ||
          actorRows[0].role !== 'client' ||
          actorRows[0].is_active !== true
        ) {
          throw new ConflictException(
            'client portal identity conflicts with an existing user',
          );
        }
      } else {
        const actors = await runner.query(
          `INSERT INTO public.app_users(id,organization_id,name,email,role,is_active)
           VALUES(public.uuid_generate_v4(),$1,$2,lower($3),'client',true)
           RETURNING id`,
          [
            identity.organizationId,
            `${applicant.first_name ?? ''} ${applicant.last_name ?? ''}`.trim() ||
              intake.email,
            intake.email,
          ],
        );
        clientActorId = actors[0].id;
      }
      await runner.query(
        `INSERT INTO public.organization_memberships(organization_id,app_user_id,role,status)
         VALUES($1,$2,'client','active')
         ON CONFLICT(organization_id,app_user_id) DO NOTHING`,
        [identity.organizationId, clientActorId],
      );
      const activeMembership = await runner.query(
        `SELECT id FROM public.organization_memberships
          WHERE organization_id=$1 AND app_user_id=$2
            AND role='client' AND status='active'`,
        [identity.organizationId, clientActorId],
      );
      if (!activeMembership[0]) {
        throw new ConflictException('client portal membership is inactive');
      }
      const created = await this.insertCase(
        runner,
        intake,
        clientId,
        identity.organizationId,
      );
      const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const pinHash = await bcrypt.hash(pin, 12);
      await runner.query(
        `INSERT INTO public.client_case_access(client_id,case_id,pin_hash,enabled,pin_set_at) VALUES($1,$2,$3,true,now())`,
        [clientId, created.id, pinHash],
      );
      await runner.query(
        `UPDATE public.case_intakes SET client_id=$1,converted_case_id=$2,status='converted',updated_at=now(),metadata=metadata||jsonb_build_object('converted_by',$3::text,'converted_at',now()) WHERE id=$4`,
        [clientId, created.id, identity.actorId, id],
      );
      await runner.query(
        `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,case_id,changes) VALUES($1,$2,'INTAKE_CONVERTED','case_intake',$3,$4,$5::jsonb)`,
        [
          identity.organizationId,
          identity.actorId,
          id,
          created.id,
          JSON.stringify({
            case_number: created.case_number,
            client_id: clientId,
            portal_access: 'enabled',
          }),
        ],
      );
      await runner.commitTransaction();
      return {
        intake_id: id,
        status: 'converted',
        case_id: created.id,
        case_number: created.case_number,
        client_id: clientId,
        portal: { email: intake.email, pin },
      };
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  private async insertCase(
    runner: QueryRunner,
    intake: any,
    clientId: string,
    organizationId: string,
  ): Promise<{ id: string; case_number: string }> {
    return this.caseReferences.create(async (caseNumber) => {
      await runner.query('SAVEPOINT case_reference_attempt');
      try {
        const rows = await runner.query(
          `INSERT INTO public.cases(organization_id,client_id,case_number,title,description,status,workflow_phase,workflow_phase_number) VALUES($1,$2,$3,$4,$5,'open','transfer_preparation',1) RETURNING id,case_number`,
          [
            organizationId,
            clientId,
            caseNumber,
            `Assessment — ${intake.category || 'New matter'}`,
            intake.incident_description,
          ],
        );
        await runner.query('RELEASE SAVEPOINT case_reference_attempt');
        return rows[0];
      } catch (error) {
        await runner.query('ROLLBACK TO SAVEPOINT case_reference_attempt');
        await runner.query('RELEASE SAVEPOINT case_reference_attempt');
        throw error;
      }
    });
  }

  private assertStaff(identity: VerifiedIdentity) {
    if (
      !['admin', 'super_admin', 'investigator', 'staff'].includes(identity.role)
    )
      throw new ForbiddenException('staff access required');
  }
}
