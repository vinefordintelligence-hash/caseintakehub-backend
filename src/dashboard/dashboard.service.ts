import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Actor } from '../common/actor.service';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

interface FunctionCallRow {
  result: Record<string, unknown> | Array<Record<string, unknown>> | null;
}

@Injectable()
export class DashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private async call(actor: Actor, fn: string): Promise<unknown> {
    const rows = await this.dataSource.query<FunctionCallRow[]>(
      `SELECT public.${fn}($1) AS result`,
      [actor.organization_id],
    );
    return rows[0]?.result ?? null;
  }

  summary(actor: Actor): Promise<unknown> {
    return this.call(actor, 'vf_dashboard_summary');
  }

  phaseDistribution(actor: Actor): Promise<unknown> {
    return this.call(actor, 'vf_dashboard_phase_distribution');
  }

  timeInPhase(actor: Actor): Promise<unknown> {
    return this.call(actor, 'vf_dashboard_time_in_phase');
  }

  paymentAging(actor: Actor): Promise<unknown> {
    return this.call(actor, 'vf_dashboard_payment_aging');
  }

  listCases(actor: Actor): Promise<Array<Record<string, unknown>>> {
    return this.dataSource.query<Array<Record<string, unknown>>>(
      `SELECT c.id,c.case_number,c.title,c.status,c.legal_hold,c.workflow_phase,c.workflow_phase_number,c.priority,c.investigation_progress_percent,c.estimated_next_step,c.created_at,c.updated_at,
              cl.name AS client_name,cl.email AS client_email,
              COALESCE(lu.name,i.name) lead_investigator_name
         FROM public.cases c
         LEFT JOIN public.clients cl ON cl.id = c.client_id
         LEFT JOIN public.app_users lu ON lu.id=c.lead_investigator_user_id AND lu.organization_id=c.organization_id
         LEFT JOIN public.investigators i ON i.id=c.assigned_investigator_id AND i.organization_id=c.organization_id
        WHERE c.organization_id = $1
        ORDER BY c.created_at DESC
        LIMIT 200`,
      [actor.organization_id],
    );
  }

  async overview(actor: Actor): Promise<Record<string, unknown>> {
    const organizationId = actor.organization_id!;
    const [
      cases,
      clients,
      users,
      counts,
      payments,
      activity,
      operations,
      pendingActions,
    ] = await Promise.all([
      this.listCases(actor),
      this.dataSource.query(
        `SELECT id,name,email,created_at FROM public.clients WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 20`,
        [organizationId],
      ),
      this.dataSource.query(
        `SELECT id,name,email,role,last_sign_in_at,created_at FROM public.app_users WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 50`,
        [organizationId],
      ),
      this.dataSource.query(
        `SELECT (SELECT count(*)::int FROM public.evidence WHERE organization_id=$1) evidence,(SELECT count(*)::int FROM public.documents WHERE organization_id=$1) documents,(SELECT count(*)::int FROM public.invoices WHERE organization_id=$1) invoices,(SELECT count(*)::int FROM public.invoices WHERE organization_id=$1 AND status='paid') paid_invoices`,
        [organizationId],
      ),
      this.dataSource.query(
        `SELECT id,amount,created_at FROM public.payments WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 20`,
        [organizationId],
      ),
      this.dataSource.query(
        `SELECT * FROM (
        SELECT a.id,a.action event,a.resource_type category,a.case_id,a.created_at,c.case_number,u.name actor_name FROM public.audit_logs a LEFT JOIN public.cases c ON c.id=a.case_id AND c.organization_id=a.organization_id LEFT JOIN public.app_users u ON u.id=a.user_id AND u.organization_id=a.organization_id WHERE a.organization_id=$1
        UNION ALL SELECT t.id,COALESCE(t.title,'Timeline event'),'timeline',t.case_id,COALESCE(t.event_date,t.created_at),c.case_number,COALESCE(u.name,t.actor_name) FROM public.timeline t JOIN public.cases c ON c.id=t.case_id AND c.organization_id=t.organization_id LEFT JOIN public.app_users u ON u.id=t.actor_id AND u.organization_id=t.organization_id WHERE t.organization_id=$1
        UNION ALL SELECT d.id,'Document uploaded','document',d.case_id,COALESCE(d.uploaded_at,d.created_at),c.case_number,u.name FROM public.documents d JOIN public.cases c ON c.id=d.case_id AND c.organization_id=d.organization_id LEFT JOIN public.app_users u ON u.id=d.uploaded_by AND u.organization_id=d.organization_id WHERE d.organization_id=$1
        UNION ALL SELECT m.id,'Case message recorded','message',m.case_id,m.created_at,c.case_number,u.name FROM public.messages m JOIN public.cases c ON c.id=m.case_id AND c.organization_id=m.organization_id LEFT JOIN public.app_users u ON u.id=m.sender_id AND u.organization_id=m.organization_id WHERE m.organization_id=$1
        UNION ALL SELECT p.id,'Payment recorded','payment',i.case_id,p.created_at,c.case_number,NULL FROM public.payments p JOIN public.invoices i ON i.id=p.invoice_id AND i.organization_id=p.organization_id JOIN public.cases c ON c.id=i.case_id AND c.organization_id=p.organization_id WHERE p.organization_id=$1
      ) feed ORDER BY created_at DESC LIMIT 50`,
        [organizationId],
      ),
      this.dataSource.query(
        `SELECT
        (SELECT count(*)::int FROM public.document_requests WHERE organization_id=$1 AND status IN ('submitted','pending_review')) pending_reviews,
        (SELECT count(*)::int FROM public.evidence WHERE organization_id=$1 AND review_status IN ('pending','in_review','needs_information','manual_review')) evidence_reviews,
        (SELECT count(*)::int FROM public.payments WHERE organization_id=$1 AND verification_status IN ('pending','in_review','needs_information','manual_review')) payment_reviews,
        (SELECT count(*)::int FROM public.case_transfers WHERE organization_id=$1 AND status IN ('prepared','under_review')) transfer_reviews,
        (SELECT count(*)::int FROM public.document_requests WHERE organization_id=$1 AND status='open') open_document_requests,
        (SELECT count(*)::int FROM public.messages WHERE organization_id=$1 AND created_at>=now()-interval '30 days') recent_messages,
        (SELECT count(*)::int FROM public.case_notifications WHERE organization_id=$1 AND recipient_role='admin' AND NOT is_read) unread_notifications,
        (SELECT count(*)::int FROM public.invoices WHERE organization_id=$1 AND status NOT IN ('paid','cancelled')) outstanding_invoices,
        (SELECT count(*)::int FROM public.case_payments WHERE organization_id=$1 AND gate_enabled=true) payment_gates,
        (SELECT count(*)::int FROM public.case_withdrawal_requests WHERE organization_id=$1 AND status IN ('pending','pending_review','under_review','needs_information')) withdrawal_reviews,
        (SELECT count(*)::int FROM public.cases WHERE organization_id=$1 AND phase_deadline IS NOT NULL AND phase_deadline<now() AND status='open') workflow_alerts`,
        [organizationId],
      ),
      this.dataSource.query(
        `SELECT * FROM (
        SELECT dr.id,dr.case_id,c.case_number,'Document Review' kind,dr.title,dr.status,'normal' priority,dr.deadline due_at,dr.created_at,NULL::text assigned_actor,'/admin/documents' destination FROM public.document_requests dr JOIN public.cases c ON c.id=dr.case_id AND c.organization_id=dr.organization_id WHERE dr.organization_id=$1 AND dr.status IN ('submitted','pending_review')
        UNION ALL SELECT ca.id,ca.case_id,c.case_number,'Client Response',ca.title,ca.status::text,CASE WHEN ca.expires_at<now() THEN 'urgent' ELSE 'normal' END,ca.expires_at,ca.created_at,NULL::text,('/admin/cases/'||c.case_number||'?module=workflow') FROM public.case_client_actions ca JOIN public.cases c ON c.id=ca.case_id AND c.organization_id=ca.organization_id WHERE ca.organization_id=$1 AND ca.status NOT IN ('completed','cancelled')
        UNION ALL SELECT cp.id,cp.case_id,c.case_number,'Payment Required',COALESCE(cp.payment_title,'Payment requirement'),cp.status::text,'high',cp.due_date,cp.created_at,NULL::text,('/admin/cases/'||c.case_number||'?module=payments') FROM public.case_payments cp JOIN public.cases c ON c.id=cp.case_id AND c.organization_id=cp.organization_id WHERE cp.organization_id=$1 AND cp.gate_enabled=true AND cp.status NOT IN ('paid','waived','cancelled')
        UNION ALL SELECT tr.id,tr.case_id,c.case_number,'Case Transfer Review',COALESCE(tr.transfer_reference,'Transfer review'),tr.status::text,'high',NULL::timestamptz,tr.created_at,NULL,('/admin/cases/'||c.case_number||'?module=workflow') FROM public.case_transfers tr JOIN public.cases c ON c.id=tr.case_id AND c.organization_id=tr.organization_id WHERE tr.organization_id=$1 AND tr.status IN ('prepared','under_review')
        UNION ALL SELECT w.id,w.case_id,c.case_number,'Withdrawal Review',COALESCE(w.beneficiary_name,'Withdrawal request'),w.status,'high',NULL::timestamptz,w.created_at,NULL,'/admin#withdrawal-reviews' FROM public.case_withdrawal_requests w JOIN public.cases c ON c.id=w.case_id AND c.organization_id=w.organization_id WHERE w.organization_id=$1 AND w.status IN ('pending','pending_review','under_review','needs_information')
      ) q ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,due_at ASC NULLS LAST,created_at DESC LIMIT 50`,
        [organizationId],
      ),
    ]);
    const byStatus = (status: string) =>
      cases.filter((row) => row.status === status).length;
    return {
      stats: {
        totalCases: cases.length,
        openCases: byStatus('open'),
        onHoldCases: byStatus('on_hold'),
        closedCases: byStatus('closed'),
        archivedCases: byStatus('archived'),
        totalClients: clients.length,
        totalUsers: users.length,
        totalEvidence: Number(counts[0]?.evidence ?? 0),
        totalDocuments: Number(counts[0]?.documents ?? 0),
        totalInvoices: Number(counts[0]?.invoices ?? 0),
        paidInvoices: Number(counts[0]?.paid_invoices ?? 0),
        totalPayments: payments.reduce(
          (sum, row) => sum + Number(row.amount ?? 0),
          0,
        ),
      },
      operations: operations[0] ?? {},
      pendingActions,
      cases: cases.slice(0, 20),
      clients,
      users,
      payments,
      activity,
    };
  }

  async search(
    actor: Actor,
    rawQuery: string,
  ): Promise<Record<string, unknown>> {
    const query = rawQuery.trim();
    if (query.length < 2) return { items: [] };
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const items = await this.dataSource.query(
      `SELECT * FROM (
      SELECT 'case' type,c.id,c.case_number label,COALESCE(c.title,cl.name,'Case') detail,('/admin/cases/'||c.case_number) destination,c.updated_at sort_at FROM public.cases c LEFT JOIN public.clients cl ON cl.id=c.client_id AND cl.organization_id=c.organization_id WHERE c.organization_id=$1 AND (c.case_number ILIKE $2 ESCAPE '\\' OR c.title ILIKE $2 ESCAPE '\\' OR cl.name ILIKE $2 ESCAPE '\\' OR cl.email ILIKE $2 ESCAPE '\\')
      UNION ALL SELECT 'document',d.id,d.title,COALESCE(d.document_type,'Document'),('/admin/cases/'||c.case_number||'?module=documents'),d.updated_at FROM public.documents d JOIN public.cases c ON c.id=d.case_id AND c.organization_id=d.organization_id WHERE d.organization_id=$1 AND (d.title ILIKE $2 ESCAPE '\\' OR d.file_name ILIKE $2 ESCAPE '\\')
      UNION ALL SELECT 'invoice',i.id,i.invoice_number,('Invoice · '||i.status),('/admin/cases/'||c.case_number||'?module=invoices'),i.updated_at FROM public.invoices i JOIN public.cases c ON c.id=i.case_id AND c.organization_id=i.organization_id WHERE i.organization_id=$1 AND i.invoice_number ILIKE $2 ESCAPE '\\'
    ) results ORDER BY sort_at DESC NULLS LAST LIMIT 30`,
      [actor.organization_id, pattern],
    );
    return { items };
  }

  async workspace(
    actor: Actor,
    module: string,
  ): Promise<Record<string, unknown>> {
    const org = actor.organization_id!;
    switch (module) {
      case 'clients':
        return {
          records: await this.dataSource.query(
            `SELECT cl.id,cl.name,cl.email,cl.created_at,o.name organization_name,max(c.updated_at) last_activity,COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'case_number',c.case_number,'title',c.title,'status',c.status,'updated_at',c.updated_at) ORDER BY c.updated_at DESC) FILTER (WHERE c.id IS NOT NULL),'[]'::jsonb) cases FROM public.clients cl JOIN public.organizations o ON o.id=cl.organization_id LEFT JOIN public.cases c ON c.client_id=cl.id AND c.organization_id=cl.organization_id WHERE cl.organization_id=$1 GROUP BY cl.id,o.name ORDER BY max(c.updated_at) DESC NULLS LAST,cl.created_at DESC`,
            [org],
          ),
        };
      case 'evidence':
        return {
          records: await this.dataSource.query(
            `SELECT e.id,e.case_id,c.case_number,c.title case_title,e.type,e.description,e.source,e.file_name,e.file_url,e.created_at,e.updated_at,e.review_status,e.custody_status,e.integrity_status,u.name assigned_reviewer FROM public.evidence e JOIN public.cases c ON c.id=e.case_id AND c.organization_id=e.organization_id LEFT JOIN public.app_users u ON u.id=e.reviewed_by AND u.organization_id=e.organization_id WHERE e.organization_id=$1 ORDER BY e.created_at DESC`,
            [org],
          ),
          capabilities: {
            reviewState: true,
            chainOfCustody: true,
            assignedReviewer: true,
          },
        };
      case 'workflow':
        return {
          records: await this.dataSource.query(
            `SELECT c.id,c.case_number,c.title,c.status,c.workflow_phase,c.workflow_phase_number,c.investigation_progress_percent,c.estimated_next_step,c.workflow_updated_at,c.phase_deadline,COALESCE(lu.name,i.name) investigator_name,COALESCE((SELECT count(*)::int FROM public.case_client_actions a WHERE a.case_id=c.id AND a.organization_id=c.organization_id AND a.status NOT IN ('completed','cancelled')),0) blockers,COALESCE((SELECT bool_or(p.gate_enabled AND p.blocks_progress AND p.status NOT IN ('paid','waived','cancelled')) FROM public.case_payments p WHERE p.case_id=c.id AND p.organization_id=c.organization_id),false) payment_blocked FROM public.cases c LEFT JOIN public.app_users lu ON lu.id=c.lead_investigator_user_id AND lu.organization_id=c.organization_id LEFT JOIN public.investigators i ON i.id=c.assigned_investigator_id AND i.organization_id=c.organization_id WHERE c.organization_id=$1 ORDER BY c.workflow_updated_at DESC NULLS LAST,c.updated_at DESC`,
            [org],
          ),
        };
      case 'messages':
        return {
          records: await this.dataSource.query(
            `SELECT m.id,m.case_id,c.case_number,c.title case_title,cl.name client_name,m.sender_id,u.name sender_name,u.role sender_role,m.content,m.created_at,m.updated_at FROM public.messages m JOIN public.cases c ON c.id=m.case_id AND c.organization_id=m.organization_id LEFT JOIN public.clients cl ON cl.id=c.client_id AND cl.organization_id=c.organization_id LEFT JOIN public.app_users u ON u.id=m.sender_id AND u.organization_id=m.organization_id WHERE m.organization_id=$1 ORDER BY m.created_at DESC LIMIT 500`,
            [org],
          ),
          capabilities: { readState: false, threads: false },
        };
      case 'reviews': {
        const [evidence, payments, transfers] = await Promise.all([
          this.dataSource.query(
            `SELECT e.id,e.case_id,c.case_number,e.type,e.description,e.source,e.file_name,e.created_at,e.review_status,e.custody_status,e.integrity_status,u.name reviewer_name FROM public.evidence e JOIN public.cases c ON c.id=e.case_id AND c.organization_id=e.organization_id LEFT JOIN public.app_users u ON u.id=e.reviewed_by AND u.organization_id=e.organization_id WHERE e.organization_id=$1 ORDER BY e.created_at DESC`,
            [org],
          ),
          this.dataSource.query(
            `SELECT p.id,p.organization_id,i.case_id,c.case_number,i.invoice_number,i.status invoice_status,p.amount,p.payment_method,p.reference_number,p.proof_reference,p.proof_document_id,d.title proof_document_title,d.file_name proof_document_file_name,d.uploaded_at proof_document_uploaded_at,du.name proof_document_uploader,p.created_at,'recorded' payment_state,p.verification_status,u.name reviewer_name,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',pd.id,'title',pd.title,'file_name',pd.file_name,'uploaded_at',pd.uploaded_at,'uploader',pu.name) ORDER BY pd.uploaded_at DESC) FROM public.documents pd LEFT JOIN public.app_users pu ON pu.id=pd.uploaded_by AND pu.organization_id=pd.organization_id WHERE pd.case_id=i.case_id AND pd.organization_id=p.organization_id AND pd.document_status<>'rejected' AND pd.file_url IS NOT NULL),'[]'::jsonb) available_proof_documents FROM public.payments p JOIN public.invoices i ON i.id=p.invoice_id AND i.organization_id=p.organization_id JOIN public.cases c ON c.id=i.case_id AND c.organization_id=p.organization_id LEFT JOIN public.documents d ON d.id=p.proof_document_id AND d.organization_id=p.organization_id LEFT JOIN public.app_users du ON du.id=d.uploaded_by AND du.organization_id=d.organization_id LEFT JOIN public.app_users u ON u.id=p.verified_by AND u.organization_id=p.organization_id WHERE p.organization_id=$1 ORDER BY p.created_at DESC`,
            [org],
          ),
          this.dataSource.query(
            `SELECT t.id,t.case_id,c.case_number,cl.name client_name,t.transfer_reference,t.amount,t.currency,t.mode,t.status,t.prepared_at,t.prepared_by,u.name requesting_actor,t.receiving_institution_name,t.receiving_institution_city,t.receiving_institution_country,t.receiving_details_verified,t.receiving_details_verification_note,rv.name reviewer_name,t.execution_confirmed,t.created_at,t.updated_at FROM public.case_transfers t JOIN public.cases c ON c.id=t.case_id AND c.organization_id=t.organization_id LEFT JOIN public.clients cl ON cl.id=c.client_id AND cl.organization_id=c.organization_id LEFT JOIN public.app_users u ON u.id=t.prepared_by AND u.organization_id=t.organization_id LEFT JOIN public.app_users rv ON rv.id=t.receiving_details_verified_by AND rv.organization_id=t.organization_id WHERE t.organization_id=$1 ORDER BY t.created_at DESC`,
            [org],
          ),
        ]);
        return {
          evidence,
          payments,
          transfers,
          capabilities: {
            evidenceReviewMutation: true,
            paymentVerificationMutation: true,
            transferReviewMutation: true,
          },
        };
      }
      default:
        throw new BadRequestException('unknown admin workspace');
    }
  }

  async review(
    actor: Actor,
    type: string,
    id: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const action = String(body.action ?? ''),
      note = typeof body.note === 'string' ? body.note.trim() : '';
    if (
      ![
        'approve',
        'verify',
        'reject',
        'needs_information',
        'manual_review',
        'return_correction',
      ].includes(action)
    )
      throw new BadRequestException('invalid review action');
    if (
      [
        'reject',
        'needs_information',
        'manual_review',
        'return_correction',
      ].includes(action) &&
      !note
    )
      throw new BadRequestException('review note is required');
    return this.dataSource.transaction(async (manager) => {
      const org = actor.organization_id!;
      let before: Record<string, unknown>,
        record: Record<string, unknown>,
        caseId: string,
        newStatus: string;
      if (type === 'evidence') {
        before = (
          await manager.query(
            `SELECT e.* FROM public.evidence e JOIN public.cases c ON c.id=e.case_id AND c.organization_id=e.organization_id WHERE e.id=$1 AND e.organization_id=$2 FOR UPDATE`,
            [id, org],
          )
        )[0];
        if (!before) throw new NotFoundException('evidence not found');
        caseId = String(before.case_id);
        newStatus =
          action === 'approve' || action === 'verify'
            ? 'approved'
            : action === 'reject'
              ? 'rejected'
              : action === 'needs_information'
                ? 'needs_information'
                : 'manual_review';
        if (before.review_status === newStatus) return before;
        record = (
          await manager.query(
            `UPDATE public.evidence SET review_status=$1,reviewed_by=$2,reviewed_at=now(),review_note=$3,updated_at=now() WHERE id=$4 AND organization_id=$5 RETURNING *`,
            [newStatus, actor.id, note || null, id, org],
          )
        )[0];
      } else if (type === 'payment') {
        before = (
          await manager.query(
            `SELECT p.*,i.case_id,i.invoice_number,i.amount invoice_amount FROM public.payments p JOIN public.invoices i ON i.id=p.invoice_id AND i.organization_id=p.organization_id JOIN public.cases c ON c.id=i.case_id AND c.organization_id=p.organization_id WHERE p.id=$1 AND p.organization_id=$2 FOR UPDATE OF p`,
            [id, org],
          )
        )[0];
        if (!before)
          throw new NotFoundException('authoritative payment not found');
        caseId = String(before.case_id);
        newStatus =
          action === 'approve' || action === 'verify'
            ? 'verified'
            : action === 'reject'
              ? 'rejected'
              : action === 'needs_information'
                ? 'needs_information'
                : 'manual_review';
        if (before.verification_status === newStatus) return before;
        if (
          before.verification_status === 'verified' ||
          before.verification_status === 'rejected'
        )
          throw new BadRequestException(
            'payment verification is already in a terminal state',
          );
        const proofId =
          typeof body.proof_document_id === 'string'
            ? body.proof_document_id
            : String(before.proof_document_id ?? '');
        if (newStatus === 'verified') {
          if (!proofId)
            throw new BadRequestException(
              'an authoritative supporting proof document is required',
            );
          const proof = (
            await manager.query(
              `SELECT d.id FROM public.documents d WHERE d.id=$1 AND d.organization_id=$2 AND d.case_id=$3 AND d.document_status<>'rejected' AND d.file_url IS NOT NULL AND btrim(d.file_url)<>''`,
              [proofId, org, caseId],
            )
          )[0];
          if (!proof)
            throw new BadRequestException(
              'supporting proof document is missing, rejected, or does not belong to this case and organization',
            );
          if (!before.reference_number)
            throw new BadRequestException(
              'authoritative payment reference is required before verification',
            );
          const duplicate = (
            await manager.query(
              `SELECT id FROM public.payments WHERE organization_id=$1 AND reference_number=$2 AND id<>$3 LIMIT 1`,
              [org, before.reference_number, id],
            )
          )[0];
          if (duplicate)
            throw new BadRequestException(
              'duplicate payment reference requires manual review',
            );
          if (
            !Number.isFinite(Number(before.amount)) ||
            Number(before.amount) <= 0 ||
            Number(before.amount) > Number(before.invoice_amount)
          )
            throw new BadRequestException(
              'payment amount is invalid for the linked invoice',
            );
        } else if (proofId) {
          const proof = (
            await manager.query(
              `SELECT d.id FROM public.documents d WHERE d.id=$1 AND d.organization_id=$2 AND d.case_id=$3`,
              [proofId, org, caseId],
            )
          )[0];
          if (!proof)
            throw new BadRequestException(
              'supporting proof document does not belong to this case and organization',
            );
        }
        record = (
          await manager.query(
            `UPDATE public.payments SET verification_status=$1,verified_by=$2,verified_at=now(),verification_note=$3,proof_document_id=COALESCE($4::uuid,proof_document_id),updated_at=now() WHERE id=$5 AND organization_id=$6 RETURNING *`,
            [newStatus, actor.id, note || null, proofId || null, id, org],
          )
        )[0];
      } else if (type === 'transfer') {
        before = (
          await manager.query(
            `SELECT t.*,EXISTS(SELECT 1 FROM public.app_users rq JOIN public.organization_memberships rm ON rm.app_user_id=rq.id AND rm.organization_id=t.organization_id AND rm.status='active' WHERE rq.id=t.prepared_by AND rq.organization_id=t.organization_id AND rq.is_active=true) requester_active FROM public.case_transfers t JOIN public.cases c ON c.id=t.case_id AND c.organization_id=t.organization_id WHERE t.id=$1 AND t.organization_id=$2 FOR UPDATE OF t`,
            [id, org],
          )
        )[0];
        if (!before) throw new NotFoundException('transfer not found');
        caseId = String(before.case_id);
        if (typeof body.case_id === 'string' && body.case_id !== caseId)
          throw new BadRequestException(
            'review case does not match the transfer case',
          );
        if (before.status === 'executed' || before.status === 'cancelled')
          throw new BadRequestException('terminal transfer cannot be reviewed');
        newStatus =
          action === 'approve' || action === 'verify'
            ? 'verified'
            : action === 'reject'
              ? 'rejected'
              : 'under_review';
        if (before.status === newStatus) return before;
        if (newStatus === 'verified') {
          if (String(before.prepared_by) === actor.id)
            throw new ForbiddenException(
              'requester cannot approve their own transfer',
            );
          if (before.requester_active !== true)
            throw new BadRequestException(
              'transfer requester is no longer an active member of the requesting organization',
            );
          if (before.status !== 'under_review')
            throw new BadRequestException(
              'transfer must be under review before approval',
            );
          const missing = this.transferApprovalErrors(before);
          if (missing.length)
            throw new BadRequestException(
              `Transfer approval blocked: ${missing.join('; ')}`,
            );
        }
        record = (
          await manager.query(
            `UPDATE public.case_transfers SET status=$1::public.transfer_status,receiving_details_verified=$2,receiving_details_verified_at=now(),receiving_details_verified_by=$3,receiving_details_verification_note=$4,updated_at=now() WHERE id=$5 AND organization_id=$6 RETURNING *`,
            [
              newStatus,
              newStatus === 'verified',
              actor.id,
              note || null,
              id,
              org,
            ],
          )
        )[0];
      } else throw new BadRequestException('unknown review type');
      await manager.query(
        `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,case_id,changes) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          org,
          actor.id,
          `${type}.review.${newStatus}`,
          type,
          id,
          caseId,
          JSON.stringify({
            previous_status:
              type === 'payment'
                ? before.verification_status
                : type === 'evidence'
                  ? before.review_status
                  : before.status,
            new_status: newStatus,
            note: note || null,
            ...(type === 'payment'
              ? {
                  proof_document_id:
                    record.proof_document_id ??
                    before.proof_document_id ??
                    null,
                  invoice_number: before.invoice_number,
                  payment_reference: before.reference_number,
                }
              : {
                  destination_reference: before.transfer_reference,
                  receiving_institution: before.receiving_institution_name,
                  receiving_country: before.receiving_institution_country,
                }),
          }),
        ],
      );
      await manager.query(
        `INSERT INTO public.case_notifications(case_id,organization_id,recipient_role,title,body) VALUES($1,$2,'client',$3,$4)`,
        [
          caseId,
          org,
          `${type[0].toUpperCase() + type.slice(1)} review updated`,
          `Review status: ${newStatus.replace(/_/g, ' ')}`,
        ],
      );
      return record;
    });
  }

  private transferApprovalErrors(transfer: Record<string, unknown>): string[] {
    const errors: string[] = [],
      text = (key: string) =>
        typeof transfer[key] === 'string' ? transfer[key].trim() : '';
    const institution = text('receiving_institution_name'),
      country = text('receiving_institution_country'),
      account = text('receiving_account_number').replace(/[\s-]/g, ''),
      beneficiary = text('beneficiary_legal_name') || text('beneficiary_name'),
      swift = text('receiving_institution_swift')
        .replace(/\s/g, '')
        .toUpperCase(),
      routing = text('receiving_institution_routing_number')
        .replace(/[\s-]/g, '')
        .toUpperCase(),
      currency = text('currency').toUpperCase();
    if (institution.length < 2)
      errors.push('receiving institution name is required');
    if (country.length < 2 || country.length > 80)
      errors.push('receiving country is required');
    if (!/^[A-Z0-9]{4,34}$/i.test(account))
      errors.push(
        'receiving account number must contain 4–34 letters or digits',
      );
    if (beneficiary.length < 2) errors.push('beneficiary name is required');
    if (swift && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(swift))
      errors.push('SWIFT/BIC must contain 8 or 11 letters or digits');
    if (routing && !/^[A-Z0-9]{5,18}$/.test(routing))
      errors.push('routing identifier must contain 5–18 letters or digits');
    if (!swift && !routing)
      errors.push('a valid SWIFT/BIC or routing identifier is required');
    if (
      !Number.isFinite(Number(transfer.amount)) ||
      Number(transfer.amount) <= 0
    )
      errors.push('transfer amount must be greater than zero');
    if (!/^[A-Z]{3}$/.test(currency))
      errors.push('currency must be a three-letter ISO code');
    if (text('transfer_reference').length < 3)
      errors.push('transfer reference is required');
    return errors;
  }

  async caseDetail(
    actor: Actor,
    caseId: string,
  ): Promise<Record<string, unknown>> {
    const org = actor.organization_id!;
    const rows = await this.dataSource.query(
      `SELECT c.*,cl.name client_name,cl.email client_email,cl.phone client_phone,
      cl.address client_address,cl.city client_city,cl.state client_state,cl.zip_code client_zip_code,cl.country client_country,
      o.name organization_name,o.slug organization_slug,
      i.name investigator_name,i.title investigator_title,i.email investigator_email,i.specialization investigator_specialization,
      assignee.name assigned_user_name,assignee.email assigned_user_email
      FROM public.cases c
      LEFT JOIN public.clients cl ON cl.id=c.client_id AND cl.organization_id=c.organization_id
      JOIN public.organizations o ON o.id=c.organization_id
      LEFT JOIN public.investigators i ON i.id=c.assigned_investigator_id AND i.organization_id=c.organization_id
      LEFT JOIN public.app_users assignee ON assignee.id=c.assigned_to AND assignee.organization_id=c.organization_id
      WHERE (c.id::text=$1 OR c.case_number=$1) AND c.organization_id=$2`,
      [caseId, org],
    );
    if (!rows[0]) throw new NotFoundException('case not found');
    const resolvedCaseId = String(rows[0].id);
    const q = (sql: string) =>
      this.dataSource.query(sql, [resolvedCaseId, org]);
    const [
      timeline,
      documents,
      evidence,
      documentRequests,
      messages,
      invoices,
      payments,
      casePayments,
      audit,
      assignments,
      clientActions,
      transfers,
      transferRequirements,
      notifications,
      engagementSignatures,
      clientAccess,
      fundingPrograms,
      fundingRecipients,
      treasuryAccounts,
      treasuryLedger,
      depositAddresses,
      chainWithdrawals,
      assets,
      recoveries,
      recoveryEvents,
      transactions,
      withdrawalRequests,
      intelligenceTraces,
      handoffGrants,
    ] = await Promise.all([
      q(
        `SELECT * FROM public.timeline WHERE case_id=$1 AND organization_id=$2 ORDER BY event_date DESC NULLS LAST,created_at DESC`,
      ),
      q(
        `SELECT * FROM public.documents WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.evidence WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.document_requests WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT m.*,u.name sender_name,u.email sender_email FROM public.messages m LEFT JOIN public.app_users u ON u.id=m.sender_id WHERE m.case_id=$1 AND m.organization_id=$2 ORDER BY m.created_at DESC`,
      ),
      q(
        `SELECT * FROM public.invoices WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT p.* FROM public.payments p JOIN public.invoices i ON i.id=p.invoice_id WHERE i.case_id=$1 AND p.organization_id=$2 ORDER BY p.created_at DESC`,
      ),
      q(
        `SELECT * FROM public.case_payments WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.audit_logs WHERE organization_id=$2 AND (case_id=$1 OR resource_id=$1) ORDER BY created_at DESC LIMIT 500`,
      ),
      q(
        `SELECT a.*,u.name,u.email FROM public.case_assignments a JOIN public.app_users u ON u.id=a.app_user_id WHERE a.case_id=$1 AND a.organization_id=$2 ORDER BY a.active DESC,a.assigned_at DESC`,
      ),
      q(
        `SELECT * FROM public.case_client_actions WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.case_transfers WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.transfer_document_requirements WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.case_notifications WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.engagement_signatures WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT a.* FROM public.client_case_access a JOIN public.cases c ON c.id=a.case_id WHERE a.case_id=$1 AND c.organization_id=$2 ORDER BY a.created_at DESC`,
      ),
      q(
        `SELECT * FROM public.funding_programs WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.funding_recipients WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.treasury_accounts WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.treasury_ledger_entries WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.treasury_deposit_addresses WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.treasury_chain_withdrawals WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.case_assets WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.case_recoveries WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.case_recovery_events WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.case_transactions WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.case_withdrawal_requests WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.case_intelligence_traces WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
      q(
        `SELECT * FROM public.case_handoff_grants WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      ),
    ]);
    return {
      case: rows[0],
      timeline,
      documents,
      evidence,
      documentRequests,
      messages,
      invoices,
      payments,
      casePayments,
      audit,
      assignments,
      clientActions,
      transfers,
      transferRequirements,
      notifications,
      engagementSignatures,
      clientAccess,
      fundingPrograms,
      fundingRecipients,
      treasuryAccounts,
      treasuryLedger,
      depositAddresses,
      chainWithdrawals,
      otherRelationships: {
        assets,
        recoveries,
        recoveryEvents,
        transactions,
        withdrawalRequests,
        intelligenceTraces,
        handoffGrants,
      },
    };
  }

  async caseModule(
    actor: Actor,
    caseKey: string,
    module: string,
  ): Promise<Record<string, unknown>> {
    const organizationId = actor.organization_id!;
    const cases = await this.dataSource.query(
      `SELECT c.*,cl.name client_name,cl.email client_email,cl.phone client_phone,cl.address client_address,cl.city client_city,cl.state client_state,cl.zip_code client_zip_code,cl.country client_country,o.name organization_name,i.name investigator_name,i.title investigator_title,i.email investigator_email,i.specialization investigator_specialization FROM public.cases c LEFT JOIN public.clients cl ON cl.id=c.client_id AND cl.organization_id=c.organization_id JOIN public.organizations o ON o.id=c.organization_id LEFT JOIN public.investigators i ON i.id=c.assigned_investigator_id AND i.organization_id=c.organization_id WHERE (c.id::text=$1 OR upper(c.case_number)=upper($1)) AND c.organization_id=$2`,
      [caseKey.trim(), organizationId],
    );
    if (!cases[0]) throw new NotFoundException('case not found');
    const caseRow = cases[0],
      caseId = String(caseRow.id),
      q = (sql: string) => this.dataSource.query(sql, [caseId, organizationId]);
    switch (module) {
      case 'overview': {
        const [recentActivity, outstandingActions] = await Promise.all([
          q(
            `SELECT id,title,description,phase,status,event_date,created_at FROM public.timeline WHERE case_id=$1 AND organization_id=$2 ORDER BY event_date DESC NULLS LAST,created_at DESC LIMIT 5`,
          ),
          q(
            `SELECT id,title,description,status,expires_at,created_at FROM public.case_client_actions WHERE case_id=$1 AND organization_id=$2 AND status NOT IN ('completed','cancelled') ORDER BY created_at DESC LIMIT 10`,
          ),
        ]);
        return { case: caseRow, recentActivity, outstandingActions };
      }
      case 'timeline':
        return {
          case: caseRow,
          records: await q(
            `SELECT t.*,u.name actor_name FROM public.timeline t LEFT JOIN public.app_users u ON u.id=t.actor_id WHERE t.case_id=$1 AND t.organization_id=$2 ORDER BY t.event_date DESC NULLS LAST,t.created_at DESC`,
          ),
        };
      case 'documents':
        return {
          case: caseRow,
          records: await q(
            `SELECT d.*,u.name uploader_name FROM public.documents d LEFT JOIN public.app_users u ON u.id=d.uploaded_by WHERE d.case_id=$1 AND d.organization_id=$2 ORDER BY d.created_at DESC`,
          ),
        };
      case 'evidence':
        return {
          case: caseRow,
          records: await q(
            `SELECT * FROM public.evidence WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
          ),
        };
      case 'messages':
        return {
          case: caseRow,
          records: await q(
            `SELECT m.*,u.name sender_name,u.email sender_email FROM public.messages m LEFT JOIN public.app_users u ON u.id=m.sender_id WHERE m.case_id=$1 AND m.organization_id=$2 ORDER BY m.created_at ASC`,
          ),
        };
      case 'invoices':
        return {
          case: caseRow,
          records: await q(
            `SELECT i.*,EXISTS(SELECT 1 FROM public.payments p WHERE p.invoice_id=i.id) has_linked_payment FROM public.invoices i WHERE i.case_id=$1 AND i.organization_id=$2 ORDER BY i.created_at DESC`,
          ),
        };
      case 'payments': {
        const [records, gates] = await Promise.all([
          q(
            `SELECT p.*,i.invoice_number FROM public.payments p JOIN public.invoices i ON i.id=p.invoice_id WHERE i.case_id=$1 AND p.organization_id=$2 ORDER BY p.created_at DESC`,
          ),
          q(
            `SELECT * FROM public.case_payments WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
          ),
        ]);
        return { case: caseRow, records, gates };
      }
      case 'workflow': {
        const [actions, transfers, requirements, history] = await Promise.all([
          q(
            `SELECT * FROM public.case_client_actions WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
          ),
          q(
            `SELECT * FROM public.case_transfers WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
          ),
          q(
            `SELECT * FROM public.transfer_document_requirements WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
          ),
          q(
            `SELECT * FROM public.case_recovery_events WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
          ),
        ]);
        return { case: caseRow, actions, transfers, requirements, history };
      }
      case 'treasury': {
        const [accounts, ledger, funding, depositAddresses, withdrawals] =
          await Promise.all([
            q(
              `SELECT a.*,COALESCE(SUM(CASE WHEN e.entry_type IN ('credit','adjustment') THEN e.amount WHEN e.entry_type IN ('debit','release','allocation') THEN -e.amount ELSE 0 END),0) derived_balance FROM public.treasury_accounts a LEFT JOIN public.treasury_ledger_entries e ON e.treasury_account_id=a.id WHERE a.case_id=$1 AND a.organization_id=$2 GROUP BY a.id ORDER BY a.created_at DESC`,
            ),
            q(
              `SELECT * FROM public.treasury_ledger_entries WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
            ),
            q(
              `SELECT f.*,u.name submitted_by_name,v.name verified_by_name FROM public.treasury_funding_allocations f LEFT JOIN public.app_users u ON u.id=f.submitted_by LEFT JOIN public.app_users v ON v.id=f.verified_by WHERE f.case_id=$1 AND f.organization_id=$2 ORDER BY f.created_at DESC`,
            ),
            q(
              `SELECT * FROM public.treasury_deposit_addresses WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
            ),
            q(
              `SELECT * FROM public.treasury_chain_withdrawals WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
            ),
          ]);
        return {
          case: caseRow,
          accounts,
          ledger,
          funding,
          depositAddresses,
          withdrawals,
        };
      }
      case 'audit':
        return {
          case: caseRow,
          records: await q(
            `SELECT a.*,u.name actor_name,u.email actor_email FROM public.audit_logs a LEFT JOIN public.app_users u ON u.id=a.user_id WHERE a.organization_id=$2 AND (a.case_id=$1 OR a.resource_id=$1) ORDER BY a.created_at DESC LIMIT 500`,
          ),
        };
      case 'client': {
        const [documentRequests, access, notifications] = await Promise.all([
          q(
            `SELECT * FROM public.document_requests WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
          ),
          q(
            `SELECT a.* FROM public.client_case_access a JOIN public.cases c ON c.id=a.case_id WHERE a.case_id=$1 AND c.organization_id=$2 ORDER BY a.created_at DESC`,
          ),
          q(
            `SELECT * FROM public.case_notifications WHERE case_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
          ),
        ]);
        return { case: caseRow, documentRequests, access, notifications };
      }
      default:
        throw new BadRequestException('unknown case workspace module');
    }
  }

  private async scopedCase(
    actor: Actor,
    caseKey: string,
    manager: DataSource = this.dataSource,
  ): Promise<Record<string, unknown>> {
    const rows = await manager.query(
      `SELECT id,case_number,client_id,organization_id FROM public.cases WHERE (id::text=$1 OR upper(case_number)=upper($1)) AND organization_id=$2`,
      [caseKey.trim(), actor.organization_id],
    );
    if (!rows[0]) throw new NotFoundException('case not found');
    return rows[0];
  }
  private requiredText(
    body: Record<string, unknown>,
    key: string,
    max = 1000,
  ): string {
    const value = typeof body[key] === 'string' ? body[key].trim() : '';
    if (!value || value.length > max)
      throw new BadRequestException(
        `${key} is required and must be at most ${max} characters`,
      );
    return value;
  }

  async createCaseModuleRecord(
    actor: Actor,
    caseKey: string,
    module: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.dataSource.transaction(async (manager) => {
      const c = await this.scopedCase(
        actor,
        caseKey,
        manager as unknown as DataSource,
      );
      let record: Record<string, unknown>, action: string;
      if (module === 'timeline') {
        const title = this.requiredText(body, 'title', 160);
        record = (
          await manager.query(
            `INSERT INTO public.timeline(case_id,organization_id,title,description,event_date,phase,actor_id,is_client_visible,metadata) VALUES($1,$2,$3,$4,COALESCE($5::timestamptz,now()),$6,$7,$8,'{}'::jsonb) RETURNING *`,
            [
              c.id,
              c.organization_id,
              title,
              typeof body.description === 'string'
                ? body.description.trim() || null
                : null,
              typeof body.event_date === 'string' ? body.event_date : null,
              typeof body.phase === 'string' ? body.phase.trim() || null : null,
              actor.id,
              body.is_client_visible === true,
            ],
          )
        )[0];
        action = 'timeline.created';
      } else if (module === 'documents') {
        const title = this.requiredText(body, 'title', 200);
        record = (
          await manager.query(
            `INSERT INTO public.documents(case_id,organization_id,title,description,document_type,file_url,file_name,document_status,is_client_visible,uploaded_by,uploaded_at,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now(),'{}'::jsonb) RETURNING *`,
            [
              c.id,
              c.organization_id,
              title,
              typeof body.description === 'string'
                ? body.description.trim() || null
                : null,
              typeof body.document_type === 'string'
                ? body.document_type.trim() || null
                : null,
              typeof body.file_url === 'string'
                ? body.file_url.trim() || null
                : null,
              typeof body.file_name === 'string'
                ? body.file_name.trim() || null
                : null,
              ['submitted', 'under_review', 'approved', 'rejected'].includes(
                String(body.document_status),
              )
                ? body.document_status
                : 'submitted',
              body.is_client_visible === true,
              actor.id,
            ],
          )
        )[0];
        action = 'document.created';
      } else if (module === 'document-requests') {
        const title = this.requiredText(body, 'title', 200);
        record = (
          await manager.query(
            `INSERT INTO public.document_requests(case_id,organization_id,title,description,deadline,is_client_visible,created_by) VALUES($1,$2,$3,$4,$5::timestamptz,$6,$7) RETURNING *`,
            [
              c.id,
              c.organization_id,
              title,
              typeof body.description === 'string'
                ? body.description.trim() || null
                : null,
              typeof body.deadline === 'string' && body.deadline
                ? body.deadline
                : null,
              body.is_client_visible !== false,
              actor.id,
            ],
          )
        )[0];
        action = 'document_request.created';
      } else if (module === 'evidence') {
        const type = this.requiredText(body, 'type', 120);
        record = (
          await manager.query(
            `INSERT INTO public.evidence(case_id,organization_id,type,description,file_url,file_name,file_size) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [
              c.id,
              c.organization_id,
              type,
              typeof body.description === 'string'
                ? body.description.trim() || null
                : null,
              typeof body.file_url === 'string'
                ? body.file_url.trim() || null
                : null,
              typeof body.file_name === 'string'
                ? body.file_name.trim() || null
                : null,
              typeof body.file_size === 'number' ? body.file_size : null,
            ],
          )
        )[0];
        action = 'evidence.created';
      } else if (module === 'messages') {
        const content = this.requiredText(body, 'content', 5000);
        const rows = await manager.query(
          `SELECT public.vf_send_case_message($1,$2,$3) AS result`,
          [c.id, actor.id, content],
        );
        record = rows[0]?.result;
        if (!record?.id)
          throw new BadRequestException('message was not created');
        await manager.query(
          `INSERT INTO public.case_notifications(case_id,organization_id,recipient_role,title,body) VALUES($1,$2,'client','New case message',$3)`,
          [c.id, c.organization_id, content.slice(0, 500)],
        );
        action = 'message.created';
      } else if (module === 'invoices') {
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount <= 0)
          throw new BadRequestException('amount must be greater than zero');
        if (body.status === 'paid')
          throw new BadRequestException(
            'paid status is derived from authoritative payment records',
          );
        const number =
          typeof body.invoice_number === 'string' && body.invoice_number.trim()
            ? body.invoice_number.trim()
            : `INV-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        record = (
          await manager.query(
            `INSERT INTO public.invoices(organization_id,client_id,case_id,invoice_number,amount,status,due_date) VALUES($1,$2,$3,$4,$5,$6,$7::date) RETURNING *`,
            [
              c.organization_id,
              c.client_id,
              c.id,
              number,
              amount,
              ['draft', 'sent', 'overdue'].includes(String(body.status))
                ? body.status
                : 'draft',
              typeof body.due_date === 'string' && body.due_date
                ? body.due_date
                : null,
            ],
          )
        )[0];
        action = 'invoice.created';
      } else throw new BadRequestException('unsupported case module mutation');
      await manager.query(
        `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,case_id,changes) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          c.organization_id,
          actor.id,
          action,
          module,
          String(record.id),
          c.id,
          JSON.stringify({ new: record }),
        ],
      );
      return record;
    });
  }

  async updateCaseModuleRecord(
    actor: Actor,
    caseKey: string,
    module: string,
    recordId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.dataSource.transaction(async (manager) => {
      const c = await this.scopedCase(
        actor,
        caseKey,
        manager as unknown as DataSource,
      );
      let before: Record<string, unknown>, record: Record<string, unknown>;
      if (module === 'timeline') {
        before = (
          await manager.query(
            `SELECT * FROM public.timeline WHERE id=$1 AND case_id=$2 AND organization_id=$3`,
            [recordId, c.id, c.organization_id],
          )
        )[0];
        if (!before) throw new NotFoundException('timeline event not found');
        record = (
          await manager.query(
            `UPDATE public.timeline SET title=COALESCE($1,title),description=CASE WHEN $2 THEN $3 ELSE description END,event_date=COALESCE($4::timestamptz,event_date),phase=CASE WHEN $5 THEN $6 ELSE phase END,is_client_visible=COALESCE($7,is_client_visible),updated_at=now() WHERE id=$8 AND case_id=$9 AND organization_id=$10 RETURNING *`,
            [
              typeof body.title === 'string' && body.title.trim()
                ? body.title.trim()
                : null,
              body.description !== undefined,
              typeof body.description === 'string'
                ? body.description.trim() || null
                : null,
              typeof body.event_date === 'string' && body.event_date
                ? body.event_date
                : null,
              body.phase !== undefined,
              typeof body.phase === 'string' ? body.phase.trim() || null : null,
              typeof body.is_client_visible === 'boolean'
                ? body.is_client_visible
                : null,
              recordId,
              c.id,
              c.organization_id,
            ],
          )
        )[0];
      } else if (module === 'documents') {
        before = (
          await manager.query(
            `SELECT * FROM public.documents WHERE id=$1 AND case_id=$2 AND organization_id=$3`,
            [recordId, c.id, c.organization_id],
          )
        )[0];
        if (!before) throw new NotFoundException('document not found');
        if (body.document_status === 'paid')
          throw new BadRequestException('invalid document status');
        record = (
          await manager.query(
            `UPDATE public.documents SET title=COALESCE($1,title),description=CASE WHEN $2 THEN $3 ELSE description END,document_status=COALESCE($4,document_status),is_client_visible=COALESCE($5,is_client_visible),updated_at=now() WHERE id=$6 AND case_id=$7 AND organization_id=$8 RETURNING *`,
            [
              typeof body.title === 'string' && body.title.trim()
                ? body.title.trim()
                : null,
              body.description !== undefined,
              typeof body.description === 'string'
                ? body.description.trim() || null
                : null,
              ['submitted', 'under_review', 'approved', 'rejected'].includes(
                String(body.document_status),
              )
                ? body.document_status
                : null,
              typeof body.is_client_visible === 'boolean'
                ? body.is_client_visible
                : null,
              recordId,
              c.id,
              c.organization_id,
            ],
          )
        )[0];
      } else if (module === 'evidence') {
        before = (
          await manager.query(
            `SELECT * FROM public.evidence WHERE id=$1 AND case_id=$2 AND organization_id=$3`,
            [recordId, c.id, c.organization_id],
          )
        )[0];
        if (!before) throw new NotFoundException('evidence not found');
        record = (
          await manager.query(
            `UPDATE public.evidence SET type=COALESCE($1,type),description=CASE WHEN $2 THEN $3 ELSE description END,updated_at=now() WHERE id=$4 AND case_id=$5 AND organization_id=$6 RETURNING *`,
            [
              typeof body.type === 'string' && body.type.trim()
                ? body.type.trim()
                : null,
              body.description !== undefined,
              typeof body.description === 'string'
                ? body.description.trim() || null
                : null,
              recordId,
              c.id,
              c.organization_id,
            ],
          )
        )[0];
      } else throw new BadRequestException('unsupported case module mutation');
      await manager.query(
        `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,case_id,changes) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [
          c.organization_id,
          actor.id,
          `${module}.updated`,
          module,
          recordId,
          c.id,
          JSON.stringify({ previous: before, new: record }),
        ],
      );
      return record;
    });
  }

  async access(actor: Actor): Promise<Record<string, unknown>> {
    const organizationId = actor.organization_id!;
    const [organization, users, cases] = await Promise.all([
      this.dataSource.query(
        `SELECT id,name,slug,description,created_at,updated_at FROM public.organizations WHERE id=$1`,
        [organizationId],
      ),
      this.dataSource.query(
        `SELECT id,name,email,role,organization_id,created_at,last_sign_in_at FROM public.app_users WHERE organization_id=$1 ORDER BY created_at DESC`,
        [organizationId],
      ),
      this.dataSource.query(
        `SELECT id,case_number,title,assigned_to,status,updated_at FROM public.cases WHERE organization_id=$1 ORDER BY updated_at DESC`,
        [organizationId],
      ),
    ]);
    if (!organization[0]) throw new NotFoundException('organization not found');
    return { organization: organization[0], users, cases };
  }

  async updateRole(
    actor: Actor,
    userId: string,
    value: unknown,
  ): Promise<Record<string, unknown>> {
    if (
      typeof value !== 'string' ||
      ![
        'admin',
        'investigator',
        'financial_analyst',
        'staff',
        'client',
        'super_admin',
      ].includes(value)
    )
      throw new BadRequestException('invalid role');
    if (value === 'super_admin' && actor.role !== 'super_admin')
      throw new ForbiddenException('only super admins may assign super_admin');
    return this.dataSource.transaction(async (manager) => {
      const target = await manager.query(
        `SELECT id FROM public.app_users WHERE id=$1 AND organization_id=$2 AND is_active=true FOR UPDATE`,
        [userId, actor.organization_id],
      );
      if (!target[0])
        throw new NotFoundException('active organization user not found');
      const user = (
        await manager.query(
          `UPDATE public.app_users SET role=$3,updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id,name,email,role,organization_id,created_at,last_sign_in_at`,
          [userId, actor.organization_id, value],
        )
      )[0];
      await manager.query(
        `UPDATE public.organization_memberships SET role=$3,updated_at=now() WHERE app_user_id=$1 AND organization_id=$2 AND status='active'`,
        [userId, actor.organization_id, value],
      );
      await manager.query(
        `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,changes) VALUES($1,$2,'update_user_role','user',$3,$4::jsonb)`,
        [
          actor.organization_id,
          actor.id,
          userId,
          JSON.stringify({ role: value }),
        ],
      );
      return { ok: true, user };
    });
  }
}
