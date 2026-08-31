import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { AlgorandService } from './algorand.service';
import { randomBytes } from 'node:crypto';
import { FeaturePolicyService } from './feature-policy.service';

type Payload = Record<string, unknown>;
type Row = Record<string, any>;

@Injectable()
export class FundingService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly algorand: AlgorandService,
    private readonly featurePolicy: FeaturePolicyService,
  ) {}

  private text(value: unknown, name: string): string {
    if (typeof value !== 'string' || !value.trim())
      throw new BadRequestException(`${name} is required`);
    return value.trim();
  }

  private positive(value: unknown, name: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
      throw new BadRequestException(`${name} must be positive`);
    return parsed;
  }

  private staff(identity: VerifiedIdentity): void {
    if (identity.role === 'client')
      throw new ForbiddenException('staff authorization required');
  }

  private admin(identity: VerifiedIdentity): void {
    if (!['admin', 'super_admin'].includes(identity.role))
      throw new ForbiddenException('organization administrator required');
  }

  private async requireOnChainEnabled(
    identity: VerifiedIdentity,
    manager: DataSource | EntityManager = this.db,
  ): Promise<void> {
    if (manager !== this.db) {
      const state = await this.featurePolicy.state(identity, manager);
      if (!state.effective.onChainEscrowEnabled)
        throw new ForbiddenException(
          'onChainEscrowEnabled is disabled for this organization',
        );
      return;
    }
    await this.featurePolicy.require(identity, ['onChainEscrowEnabled']);
  }

  private async audit(
    identity: VerifiedIdentity,
    action: string,
    resourceType: string,
    resourceId: string,
    changes: Payload = {},
    manager: DataSource | EntityManager = this.db,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO public.audit_logs
       (organization_id,user_id,action,resource_type,resource_id,changes)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        identity.organizationId,
        identity.actorId,
        action,
        resourceType,
        resourceId,
        JSON.stringify(changes),
      ],
    );
  }

  private async programScope(
    id: string,
    identity: VerifiedIdentity,
    manager: DataSource | EntityManager = this.db,
  ): Promise<Row> {
    const clientFilter =
      identity.role === 'client'
        ? `AND (p.case_id=$3 OR EXISTS (SELECT 1 FROM public.funding_recipients r WHERE r.program_id=p.id AND r.app_user_id=$4 AND r.status='active'))`
        : '';
    const rows = await manager.query(
      `SELECT p.* FROM public.funding_programs p
       WHERE p.id=$1 AND p.organization_id=$2 ${clientFilter}`,
      [id, identity.organizationId, identity.caseId ?? null, identity.actorId],
    );
    if (!rows[0]) throw new NotFoundException('funding program not found');
    return rows[0];
  }

  private async milestoneScope(
    id: string,
    identity: VerifiedIdentity,
    manager: DataSource | EntityManager = this.db,
  ): Promise<Row> {
    const rows = await manager.query(
      `SELECT m.* FROM public.funding_milestones m
       JOIN public.funding_programs p ON p.id=m.program_id
       WHERE m.id=$1 AND m.organization_id=$2`,
      [id, identity.organizationId],
    );
    if (!rows[0]) throw new NotFoundException('funding milestone not found');
    await this.programScope(rows[0].program_id, identity, manager);
    return rows[0];
  }

  async createProgram(body: Payload, identity: VerifiedIdentity): Promise<Row> {
    this.admin(identity);
    const mode = this.text(body.funding_mode, 'funding_mode');
    if (!['managed', 'on_chain'].includes(mode))
      throw new BadRequestException('invalid funding_mode');
    const currency = this.text(body.currency, 'currency').toUpperCase();
    let chainApplicationId: number | null = null;
    let chainEscrowAddress: string | null = null;
    if (mode === 'on_chain') {
      if (body.chain_network !== 'algorand_testnet')
        throw new BadRequestException(
          'on-chain programs must use Algorand Testnet',
        );
      chainApplicationId = Number(body.chain_application_id);
      if (!Number.isSafeInteger(chainApplicationId) || chainApplicationId <= 0)
        throw new BadRequestException(
          'valid Testnet application id is required',
        );
      chainEscrowAddress = this.text(
        body.chain_escrow_address,
        'chain_escrow_address',
      );
      this.algorand.publicKey(chainEscrowAddress);
    }
    const rows = await this.db.query(
      `INSERT INTO public.funding_programs
       (organization_id,case_id,treasury_account_id,chain_network,chain_application_id,chain_escrow_address,reference_number,title,description,funding_purpose,funding_source,category,funding_mode,currency,total_amount,status,application_mode,approval_threshold,minimum_approval_count,challenge_period,eligibility_rules,start_date,end_date,responsible_administrator_id,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,make_interval(secs => $20),$21::jsonb,$22,$23,$24,$25) RETURNING *`,
      [
        identity.organizationId,
        body.case_id ?? null,
        body.treasury_account_id ?? null,
        mode === 'on_chain' ? 'algorand_testnet' : null,
        chainApplicationId,
        chainEscrowAddress,
        this.text(body.reference_number, 'reference_number'),
        this.text(body.title, 'title'),
        body.description ?? null,
        body.funding_purpose ?? null,
        body.funding_source ?? null,
        body.category ?? null,
        mode,
        currency,
        this.positive(body.total_amount, 'total_amount'),
        body.status ?? 'draft',
        body.application_mode ?? 'assigned',
        Number(body.approval_threshold ?? 50),
        Number(body.minimum_approval_count ?? 1),
        Number(body.challenge_period_seconds ?? 0),
        JSON.stringify(body.eligibility_rules ?? {}),
        body.start_date ?? null,
        body.end_date ?? null,
        body.responsible_administrator_id ?? identity.actorId,
        identity.actorId,
      ],
    );
    await this.audit(
      identity,
      'funding.program.created',
      'funding_program',
      rows[0].id,
      { funding_mode: mode, currency },
    );
    return rows[0];
  }

  async programs(identity: VerifiedIdentity, status?: string): Promise<Row[]> {
    return this.db.query(
      `SELECT p.*,
       coalesce((SELECT sum(a.amount) FROM public.funding_allocations a WHERE a.program_id=p.id AND a.status<>'cancelled'),0) AS committed_allocation,
       greatest(p.total_amount-coalesce((SELECT sum(a.amount) FROM public.funding_allocations a WHERE a.program_id=p.id AND a.status<>'cancelled'),0),0) AS available_allocation
       FROM public.funding_programs p WHERE p.organization_id=$1
       AND ($2::text IS NULL OR p.status=$2)
       AND ($3::text <> 'client' OR p.case_id=$4 OR EXISTS
         (SELECT 1 FROM public.funding_recipients r WHERE r.program_id=p.id AND r.app_user_id=$5 AND r.status='active'))
       ORDER BY p.created_at DESC`,
      [
        identity.organizationId,
        status ?? null,
        identity.role,
        identity.caseId ?? null,
        identity.actorId,
      ],
    );
  }

  program(id: string, identity: VerifiedIdentity): Promise<Row> {
    return this.programScope(id, identity);
  }

  async updateProgram(
    id: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    this.admin(identity);
    await this.programScope(id, identity);
    const allowed = [
      'title',
      'description',
      'category',
      'status',
      'application_mode',
    ];
    const keys = allowed.filter((key) => body[key] !== undefined);
    if (!keys.length)
      throw new BadRequestException('no supported changes supplied');
    const values = keys.map((key) => body[key]);
    const sets = keys.map((key, index) => `${key}=$${index + 3}`);
    const rows = await this.db.query(
      `UPDATE public.funding_programs SET ${sets.join(',')},updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [id, identity.organizationId, ...values],
    );
    await this.audit(
      identity,
      'funding.program.updated',
      'funding_program',
      id,
      { fields: keys },
    );
    return rows[0];
  }

  async addRecipient(
    programId: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    this.staff(identity);
    await this.programScope(programId, identity);
    const rows = await this.db.query(
      `INSERT INTO public.funding_recipients (organization_id,program_id,app_user_id,case_id,status,verification_status,eligibility,payment_destination,created_by)
       SELECT $1,$2,u.id,$4,$5,$6,$7::jsonb,$8::jsonb,$9 FROM public.app_users u
       JOIN public.organization_memberships m ON m.app_user_id=u.id AND m.organization_id=$1 AND m.status='active'
       WHERE u.id=$3 RETURNING *`,
      [
        identity.organizationId,
        programId,
        this.text(body.app_user_id, 'app_user_id'),
        body.case_id ?? null,
        body.status ?? 'active',
        body.verification_status ?? 'pending',
        JSON.stringify(body.eligibility ?? {}),
        JSON.stringify(body.payment_destination ?? {}),
        identity.actorId,
      ],
    );
    if (!rows[0])
      throw new BadRequestException(
        'recipient is not an active organization member',
      );
    await this.audit(
      identity,
      'funding.recipient.added',
      'funding_recipient',
      rows[0].id,
      { program_id: programId },
    );
    return rows[0];
  }

  async recipients(
    programId: string,
    identity: VerifiedIdentity,
  ): Promise<Row[]> {
    await this.programScope(programId, identity);
    return this.db.query(
      `SELECT r.*,
       coalesce((SELECT sum(a.amount) FROM public.funding_allocations a JOIN public.funding_milestones m ON m.id=a.milestone_id WHERE m.recipient_id=r.id AND a.status<>'cancelled'),0) AS approved_amount,
       coalesce((SELECT sum(fr.amount) FROM public.funding_releases fr JOIN public.funding_milestones m ON m.id=fr.milestone_id WHERE m.recipient_id=r.id AND fr.status='disbursed'),0) AS disbursed_amount,
       greatest(coalesce((SELECT sum(a.amount) FROM public.funding_allocations a JOIN public.funding_milestones m ON m.id=a.milestone_id WHERE m.recipient_id=r.id AND a.status<>'cancelled'),0)-coalesce((SELECT sum(fr.amount) FROM public.funding_releases fr JOIN public.funding_milestones m ON m.id=fr.milestone_id WHERE m.recipient_id=r.id AND fr.status='disbursed'),0),0) AS remaining_allocation
       FROM public.funding_recipients r WHERE r.organization_id=$1 AND r.program_id=$2
       AND ($3::text<>'client' OR r.app_user_id=$4) ORDER BY r.created_at DESC`,
      [identity.organizationId, programId, identity.role, identity.actorId],
    );
  }

  async assignReviewer(
    programId: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    this.admin(identity);
    await this.programScope(programId, identity);
    const reviewerId = this.text(body.reviewer_id, 'reviewer_id');
    const rows = await this.db.query(
      `INSERT INTO public.funding_program_reviewers (program_id,reviewer_id,assigned_by)
       SELECT $1,u.id,$3 FROM public.app_users u JOIN public.organization_memberships m ON m.app_user_id=u.id
       WHERE u.id=$2 AND m.organization_id=$4 AND m.status='active' AND m.role IN ('admin','reviewer','investigator') RETURNING *`,
      [programId, reviewerId, identity.actorId, identity.organizationId],
    );
    if (!rows[0])
      throw new BadRequestException(
        'reviewer is not an eligible organization member',
      );
    await this.audit(
      identity,
      'funding.reviewer.assigned',
      'funding_program',
      programId,
      { reviewer_id: reviewerId },
    );
    return rows[0];
  }

  async linkSupportingDocument(
    programId: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    await this.programScope(programId, identity);
    const documentId =
      typeof body.document_id === 'string' ? body.document_id : null;
    const evidenceId =
      typeof body.evidence_id === 'string' ? body.evidence_id : null;
    if ((documentId ? 1 : 0) + (evidenceId ? 1 : 0) !== 1)
      throw new BadRequestException(
        'exactly one document_id or evidence_id is required',
      );
    const table = documentId ? 'documents' : 'evidence';
    const sourceId = documentId ?? evidenceId!;
    const scoped = await this.db.query(
      `SELECT id FROM public.${table} WHERE id=$1 AND organization_id=$2 AND ($3::text<>'client' OR case_id=$4)`,
      [
        sourceId,
        identity.organizationId,
        identity.role,
        identity.caseId ?? null,
      ],
    );
    if (!scoped[0]) throw new NotFoundException('supporting record not found');
    const rows = await this.db.query(
      `INSERT INTO public.funding_supporting_documents (organization_id,program_id,document_id,evidence_id,linked_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [
        identity.organizationId,
        programId,
        documentId,
        evidenceId,
        identity.actorId,
      ],
    );
    await this.audit(
      identity,
      'funding.supporting_document.linked',
      'funding_supporting_document',
      rows[0].id,
      {
        program_id: programId,
        document_id: documentId,
        evidence_id: evidenceId,
      },
    );
    return rows[0];
  }

  async apply(
    programId: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    const program = await this.programScope(programId, identity);
    if (
      program.application_mode !== 'open' ||
      !['open', 'active'].includes(program.status)
    )
      throw new ConflictException('program is not accepting applications');
    const currency = this.text(body.currency, 'currency').toUpperCase();
    if (currency !== program.currency)
      throw new BadRequestException(
        'application currency does not match program',
      );
    const rows = await this.db.transaction(async (manager) => {
      const inserted = await manager.query(
        `INSERT INTO public.funding_applications
       (organization_id,program_id,applicant_id,requested_amount,currency,statement)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [
          identity.organizationId,
          programId,
          identity.actorId,
          this.positive(body.requested_amount, 'requested_amount'),
          currency,
          this.text(body.statement, 'statement'),
        ],
      );
      await manager.query(
        `INSERT INTO public.funding_application_status_history (organization_id,application_id,from_status,to_status,note,changed_by) VALUES ($1,$2,NULL,'draft',$3,$4)`,
        [
          identity.organizationId,
          inserted[0].id,
          body.statement,
          identity.actorId,
        ],
      );
      await this.audit(
        identity,
        'funding.application.created',
        'funding_application',
        inserted[0].id,
        { program_id: programId },
        manager,
      );
      return inserted;
    });
    return rows[0];
  }

  async transitionApplication(
    id: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    const target = this.text(body.status, 'status');
    const transitions: Record<string, string[]> = {
      draft: ['submitted', 'withdrawn'],
      submitted: ['under_review', 'withdrawn'],
      under_review: [
        'additional_information_required',
        'approved',
        'partially_approved',
        'rejected',
      ],
      additional_information_required: ['submitted', 'withdrawn'],
      approved: ['funded'],
      partially_approved: ['funded'],
      funded: ['completed'],
    };
    return this.db.transaction(async (manager) => {
      const rows = await manager.query(
        `SELECT * FROM public.funding_applications WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [id, identity.organizationId],
      );
      const application = rows[0];
      if (!application)
        throw new NotFoundException('funding application not found');
      const ownerAction =
        identity.role === 'client' &&
        application.applicant_id === identity.actorId &&
        ['submitted', 'withdrawn'].includes(target);
      if (!ownerAction) this.staff(identity);
      if (!(transitions[application.status] ?? []).includes(target))
        throw new ConflictException(
          `invalid application transition ${application.status} -> ${target}`,
        );
      if (
        ['approved', 'partially_approved'].includes(target) &&
        application.applicant_id === identity.actorId
      )
        throw new ForbiddenException(
          'applicants cannot approve their own funding',
        );
      const approved =
        target === 'partially_approved'
          ? this.positive(body.approved_amount, 'approved_amount')
          : target === 'approved'
            ? Number(application.requested_amount)
            : application.approved_amount;
      if (approved != null && approved > Number(application.requested_amount))
        throw new BadRequestException(
          'approved amount exceeds requested amount',
        );
      const updated = await manager.query(
        `UPDATE public.funding_applications SET status=$3,approved_amount=$4,reviewed_by=CASE WHEN $5 THEN $6 ELSE reviewed_by END,reviewed_at=CASE WHEN $5 THEN now() ELSE reviewed_at END,review_note=$7,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *`,
        [
          id,
          identity.organizationId,
          target,
          approved,
          !ownerAction,
          identity.actorId,
          body.note ?? null,
        ],
      );
      await manager.query(
        `INSERT INTO public.funding_application_status_history (organization_id,application_id,from_status,to_status,note,changed_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          identity.organizationId,
          id,
          application.status,
          target,
          body.note ?? null,
          identity.actorId,
        ],
      );
      await this.audit(
        identity,
        'funding.application.status_changed',
        'funding_application',
        id,
        { from: application.status, to: target },
        manager,
      );
      if (target === 'submitted')
        await this.notify(
          manager,
          identity,
          'application_submitted',
          'Funding application submitted',
          'A funding application is ready for review.',
          application.program_id,
          null,
          null,
          'admin',
        );
      if (['approved', 'partially_approved'].includes(target))
        await this.notify(
          manager,
          identity,
          'application_approved',
          'Funding application approved',
          String(body.note ?? ''),
          application.program_id,
          null,
          application.applicant_id,
        );
      return updated[0];
    });
  }

  async applications(
    programId: string,
    identity: VerifiedIdentity,
  ): Promise<Row[]> {
    await this.programScope(programId, identity);
    return this.db.query(
      `SELECT * FROM public.funding_applications WHERE organization_id=$1 AND program_id=$2
       AND ($3::text <> 'client' OR applicant_id=$4) ORDER BY created_at DESC`,
      [identity.organizationId, programId, identity.role, identity.actorId],
    );
  }

  async reviewApplication(
    id: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    const decision = this.text(body.status, 'status');
    if (!['approved', 'rejected'].includes(decision))
      throw new BadRequestException('status must be approved or rejected');
    return this.transitionApplication(
      id,
      { status: decision, note: body.review_note },
      identity,
    );
  }

  async createMilestone(
    programId: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    this.staff(identity);
    const program = await this.programScope(programId, identity);
    const currency = this.text(body.currency, 'currency').toUpperCase();
    if (currency !== program.currency)
      throw new BadRequestException(
        'milestone currency does not match program',
      );
    const rows = await this.db.query(
      `INSERT INTO public.funding_milestones
       (organization_id,program_id,recipient_id,title,description,requirements,evidence_requirements,sequence,allocated_amount,currency,deadline,approval_threshold,minimum_approval_count,status)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        identity.organizationId,
        programId,
        body.recipient_id ?? null,
        this.text(body.title, 'title'),
        body.description ?? null,
        JSON.stringify(body.requirements ?? []),
        JSON.stringify(body.evidence_requirements ?? []),
        Number(body.sequence),
        this.positive(body.allocated_amount, 'allocated_amount'),
        currency,
        body.deadline ?? null,
        Number(body.approval_threshold ?? program.approval_threshold),
        Number(body.minimum_approval_count ?? program.minimum_approval_count),
        body.status ?? 'draft',
      ],
    );
    await this.audit(
      identity,
      'funding.milestone.created',
      'funding_milestone',
      rows[0].id,
      { program_id: programId },
    );
    return rows[0];
  }

  async milestones(
    programId: string,
    identity: VerifiedIdentity,
  ): Promise<Row[]> {
    await this.programScope(programId, identity);
    return this.db.query(
      'SELECT * FROM public.funding_milestones WHERE organization_id=$1 AND program_id=$2 ORDER BY sequence',
      [identity.organizationId, programId],
    );
  }

  async submitMilestone(
    id: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    const milestone = await this.milestoneScope(id, identity);
    if (!['active', 'rejected', 'submitted'].includes(milestone.status))
      throw new ConflictException('milestone is not open for submission');
    const rows = await this.db.transaction(async (manager) => {
      const version = await manager.query(
        `SELECT coalesce(max(version),0)+1 AS value FROM public.funding_milestone_submissions WHERE milestone_id=$1`,
        [id],
      );
      const inserted = await manager.query(
        `INSERT INTO public.funding_milestone_submissions
         (organization_id,program_id,milestone_id,submitter_id,version,description,external_links,github_repository)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING *`,
        [
          identity.organizationId,
          milestone.program_id,
          id,
          identity.actorId,
          version[0].value,
          this.text(body.description, 'description'),
          JSON.stringify(body.external_links ?? []),
          body.github_repository ?? null,
        ],
      );
      await manager.query(
        `UPDATE public.funding_milestones SET status='submitted',updated_at=now() WHERE id=$1`,
        [id],
      );
      await this.audit(
        identity,
        'funding.milestone.submitted',
        'funding_milestone_submission',
        inserted[0].id,
        { milestone_id: id, version: version[0].value },
        manager,
      );
      await this.notify(
        manager,
        identity,
        'milestone_submitted',
        'Milestone submitted',
        'Milestone evidence is ready for review.',
        milestone.program_id,
        id,
        null,
        'reviewer',
      );
      return inserted;
    });
    return rows[0];
  }

  async openReview(
    milestoneId: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    this.staff(identity);
    const milestone = await this.milestoneScope(milestoneId, identity);
    if (milestone.status !== 'submitted')
      throw new ConflictException('milestone has not been submitted');
    const submissionId = this.text(body.submission_id, 'submission_id');
    const rows = await this.db.transaction(async (manager) => {
      const submission = await manager.query(
        'SELECT id FROM public.funding_milestone_submissions WHERE id=$1 AND milestone_id=$2 AND organization_id=$3',
        [submissionId, milestoneId, identity.organizationId],
      );
      if (!submission[0])
        throw new NotFoundException('milestone submission not found');
      const inserted = await manager.query(
        `INSERT INTO public.funding_reviews (organization_id,milestone_id,submission_id,opened_by)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [identity.organizationId, milestoneId, submissionId, identity.actorId],
      );
      await manager.query(
        `INSERT INTO public.funding_milestone_reviewers (milestone_id,reviewer_id,assigned_by)
         SELECT $1,reviewer_id,$2 FROM public.funding_program_reviewers WHERE program_id=$3
         ON CONFLICT (milestone_id,reviewer_id) DO NOTHING`,
        [milestoneId, identity.actorId, milestone.program_id],
      );
      await manager.query(
        `UPDATE public.funding_milestones SET status='under_review',updated_at=now() WHERE id=$1`,
        [milestoneId],
      );
      await this.audit(
        identity,
        'funding.review.opened',
        'funding_review',
        inserted[0].id,
        { milestone_id: milestoneId },
        manager,
      );
      await this.notify(
        manager,
        identity,
        'review_required',
        'Funding review required',
        'A milestone submission requires an independent review.',
        milestone.program_id,
        milestoneId,
        null,
        'reviewer',
      );
      return inserted;
    });
    return rows[0];
  }

  async vote(
    reviewId: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    this.staff(identity);
    const decision = this.text(body.decision, 'decision');
    if (!['approve', 'reject'].includes(decision))
      throw new BadRequestException('decision must be approve or reject');
    if (body.weight !== undefined && Number(body.weight) !== 1)
      throw new BadRequestException('weighted voting is not enabled');
    try {
      return await this.db.transaction(async (manager) => {
        const reviews = await manager.query(
          `SELECT r.*,m.program_id,m.approval_threshold,m.minimum_approval_count,p.challenge_period,s.submitter_id
           FROM public.funding_reviews r JOIN public.funding_milestones m ON m.id=r.milestone_id
           JOIN public.funding_milestone_submissions s ON s.id=r.submission_id
           JOIN public.funding_programs p ON p.id=m.program_id
           WHERE r.id=$1 AND r.organization_id=$2 AND r.status='open' FOR UPDATE OF r`,
          [reviewId, identity.organizationId],
        );
        if (!reviews[0])
          throw new NotFoundException('open funding review not found');
        const review = reviews[0];
        await this.programScope(review.program_id, identity, manager);
        if (review.submitter_id === identity.actorId)
          throw new ForbiddenException(
            'submitters cannot review their own milestone evidence',
          );
        const assigned = await manager.query(
          `SELECT 1 FROM public.funding_milestone_reviewers WHERE milestone_id=$1 AND reviewer_id=$2`,
          [review.milestone_id, identity.actorId],
        );
        if (!assigned[0] && !['admin', 'super_admin'].includes(identity.role))
          throw new ForbiddenException(
            'reviewer is not assigned to this milestone',
          );
        const votes = await manager.query(
          `INSERT INTO public.funding_votes
           (organization_id,review_id,milestone_id,reviewer_id,decision,reason,weight,source)
           VALUES ($1,$2,$3,$4,$5,$6,1,'vineford') RETURNING *`,
          [
            identity.organizationId,
            reviewId,
            review.milestone_id,
            identity.actorId,
            decision,
            body.reason ?? null,
          ],
        );
        const tally = await manager.query(
          `SELECT count(*)::int total,count(*) FILTER (WHERE decision='approve')::int approvals
           FROM public.funding_votes WHERE review_id=$1`,
          [reviewId],
        );
        const percentage = tally[0].total
          ? (tally[0].approvals * 100) / tally[0].total
          : 0;
        if (
          tally[0].approvals >= Number(review.minimum_approval_count) &&
          percentage >= Number(review.approval_threshold)
        ) {
          await manager.query(
            `UPDATE public.funding_reviews SET status='threshold_reached',closed_at=now() WHERE id=$1`,
            [reviewId],
          );
          await manager.query(
            `UPDATE public.funding_milestones SET status='approved',challenge_ends_at=now()+$2::interval,updated_at=now() WHERE id=$1`,
            [review.milestone_id, review.challenge_period],
          );
        }
        await this.audit(
          identity,
          'funding.vote.cast',
          'funding_vote',
          votes[0].id,
          { review_id: reviewId, decision },
          manager,
        );
        await this.notify(
          manager,
          identity,
          'vote_cast',
          'Funding vote recorded',
          `A reviewer voted ${decision}.`,
          review.program_id,
          review.milestone_id,
          null,
          'admin',
        );
        if (
          tally[0].approvals >= Number(review.minimum_approval_count) &&
          percentage >= Number(review.approval_threshold)
        )
          await this.notify(
            manager,
            identity,
            'threshold_reached',
            'Approval threshold reached',
            'The milestone entered its challenge period.',
            review.program_id,
            review.milestone_id,
            null,
            'admin',
          );
        return votes[0];
      });
    } catch (error: any) {
      if (error?.code === '23505')
        throw new ConflictException('reviewer has already voted');
      throw error;
    }
  }

  async allocate(
    milestoneId: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    this.admin(identity);
    const milestone = await this.milestoneScope(milestoneId, identity);
    const program = await this.programScope(milestone.program_id, identity);
    const amount = this.positive(body.amount, 'amount');
    const currency = this.text(body.currency, 'currency').toUpperCase();
    if (
      currency !== milestone.currency ||
      amount !== Number(milestone.allocated_amount)
    )
      throw new BadRequestException(
        'allocation must match milestone amount and currency',
      );
    if (program.funding_mode === 'on_chain') {
      await this.requireOnChainEnabled(identity);
      const chainId = this.text(
        body.chain_transaction_id,
        'chain_transaction_id',
      );
      const chain = await this.db.query(
        `SELECT id,amount,asset_id FROM public.funding_chain_transactions
         WHERE id=$1 AND organization_id=$2 AND program_id=$3 AND milestone_id=$4
           AND network='algorand_testnet' AND transaction_type='fund_grant' AND confirmed_round IS NOT NULL`,
        [chainId, identity.organizationId, program.id, milestoneId],
      );
      if (!chain[0])
        throw new BadRequestException(
          'verified Testnet funding transaction not found',
        );
      if (chain[0].amount != null && Number(chain[0].amount) !== amount)
        throw new BadRequestException(
          'on-chain funding amount does not match milestone allocation',
        );
      const rows = await this.db.query(
        `INSERT INTO public.funding_allocations
         (organization_id,program_id,milestone_id,treasury_account_id,chain_transaction_id,amount,currency,created_by)
         VALUES ($1,$2,$3,NULL,$4,$5,$6,$7) RETURNING *`,
        [
          identity.organizationId,
          program.id,
          milestoneId,
          chainId,
          amount,
          currency,
          identity.actorId,
        ],
      );
      await this.audit(
        identity,
        'funding.allocation.on_chain_verified',
        'funding_allocation',
        rows[0].id,
        {
          milestone_id: milestoneId,
          chain_transaction_id: chainId,
          network: 'algorand_testnet',
        },
      );
      return rows[0];
    }
    return this.db.transaction(async (manager) => {
      const accountId = this.text(
        body.treasury_account_id ?? program.treasury_account_id,
        'treasury_account_id',
      );
      const accounts = await manager.query(
        `SELECT id,currency FROM public.treasury_accounts
         WHERE id=$1 AND organization_id=$2 AND status='active' FOR UPDATE`,
        [accountId, identity.organizationId],
      );
      if (!accounts[0])
        throw new NotFoundException('active Treasury account not found');
      if (accounts[0].currency !== currency)
        throw new BadRequestException('Treasury account currency mismatch');
      const balance = await manager.query(
        `SELECT coalesce(sum(CASE WHEN entry_type='credit' THEN amount ELSE -amount END),0) AS amount
         FROM public.treasury_ledger_entries WHERE treasury_account_id=$1`,
        [accountId],
      );
      const committed = await manager.query(
        `SELECT coalesce(sum(amount),0) AS amount FROM public.funding_allocations
         WHERE treasury_account_id=$1 AND status IN ('committed','release_pending')`,
        [accountId],
      );
      if (Number(balance[0].amount) - Number(committed[0].amount) < amount)
        throw new ConflictException('insufficient available Treasury balance');
      const rows = await manager.query(
        `INSERT INTO public.funding_allocations
         (organization_id,program_id,milestone_id,treasury_account_id,amount,currency,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          identity.organizationId,
          milestone.program_id,
          milestoneId,
          accountId,
          amount,
          currency,
          identity.actorId,
        ],
      );
      await this.audit(
        identity,
        'funding.allocation.committed',
        'funding_allocation',
        rows[0].id,
        { milestone_id: milestoneId },
        manager,
      );
      return rows[0];
    });
  }

  async prepareRelease(
    milestoneId: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    this.admin(identity);
    return this.db.transaction(async (manager) => {
      const milestone = await this.milestoneScope(
        milestoneId,
        identity,
        manager,
      );
      if (milestone.status !== 'approved')
        throw new ConflictException(
          'milestone approval threshold has not been satisfied',
        );
      const held = await manager.query(
        `SELECT 1 FROM public.funding_disputes WHERE milestone_id=$1 AND organization_id=$2 AND status IN ('open','under_review','upheld') LIMIT 1`,
        [milestoneId, identity.organizationId],
      );
      if (held[0])
        throw new ConflictException('milestone release is held by a dispute');
      const allocations = await manager.query(
        `SELECT * FROM public.funding_allocations WHERE milestone_id=$1 AND organization_id=$2 AND status='committed' FOR UPDATE`,
        [milestoneId, identity.organizationId],
      );
      if (!allocations[0])
        throw new NotFoundException('committed milestone allocation not found');
      const allocation = allocations[0];
      const releases = await manager.query(
        `INSERT INTO public.funding_releases (organization_id,program_id,milestone_id,allocation_id,funding_mode,amount,currency,status,authorized_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'release_requested',$8) RETURNING *`,
        [
          identity.organizationId,
          milestone.program_id,
          milestoneId,
          allocation.id,
          body.funding_mode ?? 'managed',
          allocation.amount,
          allocation.currency,
          identity.actorId,
        ],
      );
      await manager.query(
        `UPDATE public.funding_allocations SET status='release_pending' WHERE id=$1`,
        [allocation.id],
      );
      await manager.query(
        `UPDATE public.funding_milestones SET status='release_pending',updated_at=now() WHERE id=$1`,
        [milestoneId],
      );
      await manager.query(
        `INSERT INTO public.funding_release_status_history (organization_id,release_id,from_status,to_status,note,changed_by) VALUES ($1,$2,NULL,'release_requested',$3,$4)`,
        [
          identity.organizationId,
          releases[0].id,
          body.note ?? null,
          identity.actorId,
        ],
      );
      await this.audit(
        identity,
        'funding.release.requested',
        'funding_release',
        releases[0].id,
        { milestone_id: milestoneId },
        manager,
      );
      return releases[0];
    });
  }

  async transitionRelease(
    id: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    this.admin(identity);
    const target = this.text(body.status, 'status');
    const transitions: Record<string, string[]> = {
      release_requested: ['compliance_review', 'cancelled'],
      compliance_review: ['release_authorized', 'failed', 'cancelled'],
      release_authorized: ['pending_disbursement', 'cancelled'],
    };
    if (['disbursed', 'reversed'].includes(target))
      throw new ForbiddenException(
        'disbursement completion requires the separately controlled automated release operation',
      );
    return this.db.transaction(async (manager) => {
      const rows = await manager.query(
        `SELECT * FROM public.funding_releases WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [id, identity.organizationId],
      );
      const release = rows[0];
      if (!release) throw new NotFoundException('funding release not found');
      if (!(transitions[release.status] ?? []).includes(target))
        throw new ConflictException(
          `invalid release transition ${release.status} -> ${target}`,
        );
      const updated = await manager.query(
        `UPDATE public.funding_releases SET status=$3,failure_reason=CASE WHEN $3='failed' THEN $4 ELSE failure_reason END WHERE id=$1 AND organization_id=$2 RETURNING *`,
        [id, identity.organizationId, target, body.note ?? null],
      );
      await manager.query(
        `INSERT INTO public.funding_release_status_history (organization_id,release_id,from_status,to_status,note,changed_by) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          identity.organizationId,
          id,
          release.status,
          target,
          body.note ?? null,
          identity.actorId,
        ],
      );
      await this.audit(
        identity,
        'funding.release.status_changed',
        'funding_release',
        id,
        { from: release.status, to: target },
        manager,
      );
      if (target === 'release_authorized')
        await this.notify(
          manager,
          identity,
          'release_authorized',
          'Funding release authorized',
          'The release passed compliance review and awaits disbursement.',
          release.program_id,
          release.milestone_id,
          null,
          'admin',
        );
      return updated[0];
    });
  }

  async dispute(
    milestoneId: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    const milestone = await this.milestoneScope(milestoneId, identity);
    if (!['approved', 'release_pending'].includes(milestone.status))
      throw new ConflictException('milestone is not challengeable');
    if (
      milestone.challenge_ends_at &&
      new Date(milestone.challenge_ends_at).getTime() < Date.now()
    )
      throw new ConflictException('challenge period has ended');
    const rows = await this.db.transaction(async (manager) => {
      const inserted = await manager.query(
        `INSERT INTO public.funding_disputes (organization_id,program_id,milestone_id,raised_by,reason,evidence)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING *`,
        [
          identity.organizationId,
          milestone.program_id,
          milestoneId,
          identity.actorId,
          this.text(body.reason, 'reason'),
          JSON.stringify(body.evidence ?? []),
        ],
      );
      await manager.query(
        `UPDATE public.funding_milestones SET status='challenged',updated_at=now() WHERE id=$1`,
        [milestoneId],
      );
      await this.audit(
        identity,
        'funding.dispute.raised',
        'funding_dispute',
        inserted[0].id,
        { milestone_id: milestoneId },
        manager,
      );
      await this.notify(
        manager,
        identity,
        'dispute_raised',
        'Funding release challenged',
        String(body.reason),
        milestone.program_id,
        milestoneId,
        null,
        'admin',
      );
      return inserted;
    });
    return rows[0];
  }

  async resolveDispute(
    id: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    this.admin(identity);
    const status = this.text(body.status, 'status');
    if (!['upheld', 'dismissed', 'resolved'].includes(status))
      throw new BadRequestException('invalid dispute resolution');
    return this.db.transaction(async (manager) => {
      const rows = await manager.query(
        `UPDATE public.funding_disputes SET status=$3,resolution=$4,resolved_by=$5,resolved_at=now()
         WHERE id=$1 AND organization_id=$2 AND status IN ('open','under_review') RETURNING *`,
        [
          id,
          identity.organizationId,
          status,
          this.text(body.resolution, 'resolution'),
          identity.actorId,
        ],
      );
      if (!rows[0]) throw new NotFoundException('open dispute not found');
      await manager.query(
        `UPDATE public.funding_milestones SET status=$2,updated_at=now() WHERE id=$1`,
        [
          rows[0].milestone_id,
          status === 'dismissed' ? 'approved' : 'rejected',
        ],
      );
      await this.audit(
        identity,
        'funding.dispute.resolved',
        'funding_dispute',
        id,
        { status },
        manager,
      );
      await this.notify(
        manager,
        identity,
        'dispute_resolved',
        'Funding dispute resolved',
        String(body.resolution),
        rows[0].program_id,
        rows[0].milestone_id,
        null,
        'admin',
      );
      return rows[0];
    });
  }

  async release(
    milestoneId: string,
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    this.admin(identity);
    return this.db.transaction(async (manager) => {
      const milestone = await this.milestoneScope(
        milestoneId,
        identity,
        manager,
      );
      const program = await this.programScope(
        milestone.program_id,
        identity,
        manager,
      );
      if (milestone.status !== 'approved')
        throw new ConflictException(
          'milestone approval threshold has not been satisfied',
        );
      if (
        milestone.challenge_ends_at &&
        new Date(milestone.challenge_ends_at).getTime() > Date.now()
      )
        throw new ConflictException('challenge period has not ended');
      const disputes = await manager.query(
        `SELECT id FROM public.funding_disputes WHERE milestone_id=$1 AND organization_id=$2 AND status IN ('open','under_review','upheld') LIMIT 1`,
        [milestoneId, identity.organizationId],
      );
      if (disputes[0])
        throw new ConflictException('milestone release is held by a dispute');
      const allocations = await manager.query(
        `SELECT * FROM public.funding_allocations WHERE milestone_id=$1 AND organization_id=$2 AND status IN ('committed','release_pending') FOR UPDATE`,
        [milestoneId, identity.organizationId],
      );
      if (!allocations[0])
        throw new NotFoundException('committed milestone allocation not found');
      const allocation = allocations[0];
      let ledgerId: string | null = null;
      let chainId: string | null = null;
      if (program.funding_mode === 'managed') {
        const ledger = await manager.query(
          `INSERT INTO public.treasury_ledger_entries
           (organization_id,treasury_account_id,case_id,entry_type,amount,currency,reference,source_type,source_id,created_by)
           VALUES ($1,$2,$3,'release',$4,$5,$6,'funding_milestone',$7,$8) RETURNING id`,
          [
            identity.organizationId,
            allocation.treasury_account_id,
            program.case_id,
            allocation.amount,
            allocation.currency,
            `Funding milestone ${milestoneId}`,
            milestoneId,
            identity.actorId,
          ],
        );
        ledgerId = ledger[0].id;
      } else {
        await this.requireOnChainEnabled(identity, manager);
        const transactionId = this.text(
          body.chain_transaction_id,
          'chain_transaction_id',
        );
        const chain = await manager.query(
          `SELECT id FROM public.funding_chain_transactions
           WHERE id=$1 AND organization_id=$2 AND program_id=$3 AND milestone_id=$4
             AND network='algorand_testnet' AND transaction_type='release_funds'
             AND confirmed_round IS NOT NULL AND verified_source IS NOT NULL`,
          [transactionId, identity.organizationId, program.id, milestoneId],
        );
        if (!chain[0])
          throw new BadRequestException(
            'verified Algorand Testnet release transaction not found',
          );
        chainId = chain[0].id;
      }
      const prepared = await manager.query(
        `SELECT * FROM public.funding_releases WHERE milestone_id=$1 AND organization_id=$2 FOR UPDATE`,
        [milestoneId, identity.organizationId],
      );
      if (
        prepared[0] &&
        !['release_authorized', 'pending_disbursement'].includes(
          prepared[0].status,
        )
      )
        throw new ConflictException(
          'prepared release has not been authorized for disbursement',
        );
      const releases = prepared[0]
        ? await manager.query(
            `UPDATE public.funding_releases SET status='disbursed',treasury_ledger_entry_id=$3,chain_transaction_id=$4,released_at=now()
           WHERE id=$1 AND organization_id=$2 RETURNING *`,
            [prepared[0].id, identity.organizationId, ledgerId, chainId],
          )
        : await manager.query(
            `INSERT INTO public.funding_releases
         (organization_id,program_id,milestone_id,allocation_id,funding_mode,amount,currency,status,authorized_by,treasury_ledger_entry_id,chain_transaction_id,released_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'disbursed',$8,$9,$10,now()) RETURNING *`,
            [
              identity.organizationId,
              program.id,
              milestoneId,
              allocation.id,
              program.funding_mode,
              allocation.amount,
              allocation.currency,
              identity.actorId,
              ledgerId,
              chainId,
            ],
          );
      await manager.query(
        `INSERT INTO public.funding_release_status_history (organization_id,release_id,from_status,to_status,note,changed_by)
         VALUES ($1,$2,$3,'disbursed',$4,$5)`,
        [
          identity.organizationId,
          releases[0].id,
          prepared[0]?.status ?? null,
          'Authoritative disbursement completed',
          identity.actorId,
        ],
      );
      await manager.query(
        `UPDATE public.funding_allocations SET status='released' WHERE id=$1`,
        [allocation.id],
      );
      await manager.query(
        `UPDATE public.funding_milestones SET status='released',updated_at=now() WHERE id=$1`,
        [milestoneId],
      );
      await this.audit(
        identity,
        'funding.release.completed',
        'funding_release',
        releases[0].id,
        {
          milestone_id: milestoneId,
          funding_mode: program.funding_mode,
          treasury_ledger_entry_id: ledgerId,
          chain_transaction_id: chainId,
        },
        manager,
      );
      await this.notify(
        manager,
        identity,
        'funds_released',
        'Milestone funds released',
        'The approved milestone release completed.',
        program.id,
        milestoneId,
        null,
        'admin',
      );
      return releases[0];
    });
  }

  async walletChallenge(
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    const address = this.text(body.address, 'address');
    this.algorand.publicKey(address);
    if (body.network !== 'algorand_testnet')
      throw new BadRequestException('only Algorand Testnet is enabled');
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const challenge = JSON.stringify({
      domain: 'vineford.funding.wallet',
      purpose: 'verify_algorand_wallet',
      network: 'algorand_testnet',
      organization_id: identity.organizationId,
      actor_id: identity.actorId,
      address,
      nonce: randomBytes(32).toString('base64url'),
      expires_at: expiresAt.toISOString(),
    });
    const rows = await this.db.query(
      `INSERT INTO public.funding_wallet_links
       (organization_id,app_user_id,network,address,verification_challenge,challenge_expires_at)
       VALUES ($1,$2,'algorand_testnet',$3,$4,$5)
       ON CONFLICT (app_user_id,network) DO UPDATE SET address=excluded.address,verification_challenge=excluded.verification_challenge,
       challenge_expires_at=excluded.challenge_expires_at,challenge_consumed_at=NULL,
       verified_at=NULL,verification_method=NULL,created_at=now()
       RETURNING id,network,address,verification_challenge,challenge_expires_at,verified_at`,
      [
        identity.organizationId,
        identity.actorId,
        address,
        challenge,
        expiresAt,
      ],
    );
    return rows[0];
  }

  async verifyWallet(body: Payload, identity: VerifiedIdentity): Promise<Row> {
    const linkId = this.text(body.wallet_link_id, 'wallet_link_id');
    const proof =
      typeof body.signed_transaction === 'string'
        ? body.signed_transaction
        : this.text(body.signature, 'signature');
    return this.db.transaction(async (manager) => {
      const rows = await manager.query(
        `SELECT * FROM public.funding_wallet_links
         WHERE id=$1 AND organization_id=$2 AND app_user_id=$3 AND network='algorand_testnet' FOR UPDATE`,
        [linkId, identity.organizationId, identity.actorId],
      );
      const link = rows[0];
      if (!link) throw new NotFoundException('wallet challenge not found');
      if (link.challenge_consumed_at)
        throw new ConflictException(
          'wallet challenge has already been consumed',
        );
      if (new Date(link.challenge_expires_at).getTime() <= Date.now())
        throw new ConflictException('wallet challenge has expired');
      const valid =
        typeof body.signed_transaction === 'string'
          ? this.algorand.verifySignedOwnershipTransaction(
              link.address,
              link.verification_challenge,
              proof,
            )
          : this.algorand.verifyOwnership(
              link.address,
              link.verification_challenge,
              proof,
            );
      if (!valid)
        throw new BadRequestException('invalid wallet ownership signature');
      const verified = await manager.query(
        `UPDATE public.funding_wallet_links SET challenge_consumed_at=now(),verified_at=now(),verification_method='ed25519_challenge_v1'
         WHERE id=$1 AND challenge_consumed_at IS NULL
         RETURNING id,network,address,verified_at,verification_method`,
        [linkId],
      );
      if (!verified[0])
        throw new ConflictException(
          'wallet challenge has already been consumed',
        );
      await this.audit(
        identity,
        'funding.wallet.verified',
        'funding_wallet_link',
        linkId,
        { network: 'algorand_testnet', address: link.address },
        manager,
      );
      await this.notify(
        manager,
        identity,
        'wallet_verified',
        'Wallet ownership verified',
        'Algorand Testnet wallet ownership was cryptographically verified.',
        null,
        null,
        identity.actorId,
      );
      return verified[0];
    });
  }

  async verifyChainTransaction(
    body: Payload,
    identity: VerifiedIdentity,
  ): Promise<Row> {
    this.admin(identity);
    await this.requireOnChainEnabled(identity);
    const program = await this.programScope(
      this.text(body.program_id, 'program_id'),
      identity,
    );
    if (
      program.funding_mode !== 'on_chain' ||
      program.chain_network !== 'algorand_testnet' ||
      !program.chain_application_id
    )
      throw new BadRequestException(
        'program does not have a configured Testnet escrow application',
      );
    const type = this.text(body.transaction_type, 'transaction_type');
    const allowed = [
      'create_grant',
      'fund_grant',
      'submit_milestone_reference',
      'vote',
      'release_funds',
      'challenge',
      'pause',
    ];
    if (!allowed.includes(type))
      throw new BadRequestException('invalid escrow transaction type');
    const transaction = await this.algorand.lookupTransaction(
      this.text(body.transaction_hash, 'transaction_hash'),
    );
    if (transaction.applicationId !== String(program.chain_application_id))
      throw new BadRequestException(
        'transaction does not call the configured escrow application',
      );
    this.algorand.assertEscrowMethod(type, transaction.applicationArgs);
    const wallets = await this.db.query(
      `SELECT id FROM public.funding_wallet_links WHERE organization_id=$1 AND app_user_id=$2
       AND network='algorand_testnet' AND address=$3 AND verified_at IS NOT NULL`,
      [identity.organizationId, identity.actorId, transaction.sender],
    );
    if (!wallets[0])
      throw new ForbiddenException(
        'transaction sender is not the authenticated identity verified wallet',
      );
    const milestoneId =
      typeof body.milestone_id === 'string' ? body.milestone_id : null;
    if (milestoneId) await this.milestoneScope(milestoneId, identity);
    const rows = await this.db.query(
      `INSERT INTO public.funding_chain_transactions
       (organization_id,program_id,milestone_id,network,transaction_hash,transaction_type,asset_id,amount,sender_address,receiver_address,confirmed_round,verified_source,raw_payload,verified_at)
       VALUES ($1,$2,$3,'algorand_testnet',$4,$5,$6,$7,$8,$9,$10,'algorand_indexer_v2',$11::jsonb,now()) RETURNING *`,
      [
        identity.organizationId,
        program.id,
        milestoneId,
        transaction.transactionHash,
        type,
        transaction.assetId,
        transaction.amount,
        transaction.sender,
        transaction.receiver,
        transaction.confirmedRound,
        JSON.stringify(transaction.rawPayload),
      ],
    );
    await this.audit(
      identity,
      'funding.chain_transaction.verified',
      'funding_chain_transaction',
      rows[0].id,
      {
        program_id: program.id,
        transaction_type: type,
        network: 'algorand_testnet',
      },
    );
    await this.notify(
      this.db,
      identity,
      'chain_transaction_verified',
      'Testnet transaction verified',
      'An Algorand Testnet escrow transaction was independently verified.',
      program.id,
      milestoneId,
      null,
      'admin',
    );
    return rows[0];
  }

  async notifications(identity: VerifiedIdentity): Promise<Row[]> {
    return this.db.query(
      `SELECT * FROM public.funding_notifications WHERE organization_id=$1
       AND (recipient_id=$2 OR recipient_role=$3 OR ($3<>'client' AND recipient_role='admin'))
       ORDER BY created_at DESC`,
      [identity.organizationId, identity.actorId, identity.role],
    );
  }

  async readNotification(id: string, identity: VerifiedIdentity): Promise<Row> {
    const rows = await this.db.query(
      `UPDATE public.funding_notifications SET is_read=true WHERE id=$1 AND organization_id=$2
       AND (recipient_id=$3 OR recipient_role=$4 OR ($4<>'client' AND recipient_role='admin')) RETURNING *`,
      [id, identity.organizationId, identity.actorId, identity.role],
    );
    if (!rows[0]) throw new NotFoundException('funding notification not found');
    return rows[0];
  }

  escrowContract(identity: VerifiedIdentity): Record<string, unknown> {
    this.staff(identity);
    return this.algorand.contractManifest();
  }

  private async notify(
    manager: DataSource | EntityManager,
    identity: VerifiedIdentity,
    event: string,
    title: string,
    body: string,
    programId: string | null,
    milestoneId: string | null,
    recipientId: string | null = null,
    recipientRole: string | null = null,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO public.funding_notifications
       (organization_id,program_id,milestone_id,recipient_id,recipient_role,event_type,title,body)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        identity.organizationId,
        programId,
        milestoneId,
        recipientId,
        recipientRole,
        event,
        title,
        body,
      ],
    );
  }

  async overview(identity: VerifiedIdentity): Promise<Row> {
    const rows = await this.db.query(
      `SELECT count(*)::int AS programs,
       coalesce(sum(total_amount),0) AS total_program_amount,
       count(*) FILTER (WHERE status IN ('open','active'))::int AS active_programs
       FROM public.funding_programs p WHERE p.organization_id=$1
       AND ($2::text <> 'client' OR p.case_id=$3 OR EXISTS
         (SELECT 1 FROM public.funding_recipients r WHERE r.program_id=p.id AND r.app_user_id=$4 AND r.status='active'))`,
      [
        identity.organizationId,
        identity.role,
        identity.caseId ?? null,
        identity.actorId,
      ],
    );
    return rows[0];
  }

  features(identity: VerifiedIdentity) {
    return this.featurePolicy.state(identity);
  }

  setFeatures(
    body: Payload,
    identity: VerifiedIdentity,
    correlationId?: string,
  ) {
    return this.featurePolicy.update(body, identity, correlationId);
  }

  async analytics(identity: VerifiedIdentity): Promise<Row> {
    this.staff(identity);
    const rows = await this.db.query(
      `SELECT
       coalesce((SELECT sum(amount) FROM public.funding_allocations WHERE organization_id=$1 AND status<>'cancelled'),0) AS total_committed,
       coalesce((SELECT sum(amount) FROM public.funding_releases WHERE organization_id=$1 AND status='disbursed'),0) AS total_released,
       coalesce((SELECT count(*) FILTER (WHERE status IN ('approved','released','closed'))::numeric / nullif(count(*),0)
                 FROM public.funding_milestones WHERE organization_id=$1),0) AS milestone_completion_rate,
       coalesce((SELECT count(*)::numeric / nullif((SELECT count(*) FROM public.funding_milestones WHERE organization_id=$1),0)
                 FROM public.funding_disputes WHERE organization_id=$1),0) AS dispute_rate,
       coalesce((SELECT avg(closed_at-opened_at) FROM public.funding_reviews WHERE organization_id=$1 AND closed_at IS NOT NULL),interval '0') AS average_approval_time`,
      [identity.organizationId],
    );
    return rows[0];
  }
}
