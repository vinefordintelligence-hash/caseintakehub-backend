import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource, EntityManager } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

type Payload = Record<string, unknown>;
type Row = Record<string, any>;
const MAX_FILE = 8 * 1024 * 1024;
const TYPES = [
  'passport',
  'drivers_license',
  'national_identity_card',
  'government_photo_id',
  'proof_of_address',
  'bank_statement',
  'voided_check',
  'other',
];
const MIME = ['application/pdf', 'image/jpeg', 'image/png'];

@Injectable()
export class KycService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}
  private root() {
    return (
      this.config.get<string>('KYC_PRIVATE_STORAGE_ROOT') ??
      '/opt/vineford/backend/private/kyc'
    );
  }
  private client(i: VerifiedIdentity) {
    if (i.role !== 'client' || !i.caseId)
      throw new ForbiddenException('client portal session required');
  }
  private reviewer(i: VerifiedIdentity) {
    if (!['admin', 'super_admin'].includes(i.role))
      throw new ForbiddenException('KYC review requires an administrator');
  }
  private text(v: unknown, name: string, max = 500) {
    if (typeof v !== 'string' || !v.trim() || v.trim().length > max)
      throw new BadRequestException(`${name} is required`);
    return v.trim();
  }
  private async clientContext(
    i: VerifiedIdentity,
    m: DataSource | EntityManager = this.db,
  ) {
    this.client(i);
    const rows = await m.query(
      `SELECT c.client_id,c.id case_id,cl.name,cl.address,cl.city,cl.state,cl.zip_code,cl.country FROM public.cases c JOIN public.clients cl ON cl.id=c.client_id AND cl.organization_id=c.organization_id WHERE c.id=$1 AND c.organization_id=$2`,
      [i.caseId, i.organizationId],
    );
    if (!rows[0]) throw new NotFoundException('client case not found');
    return rows[0];
  }
  private async audit(
    m: DataSource | EntityManager,
    i: VerifiedIdentity,
    action: string,
    id: string,
    changes: Payload = {},
  ) {
    await m.query(
      `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,case_id,changes) VALUES($1,$2,$3,'client_kyc',$4,$5,$6::jsonb)`,
      [
        i.organizationId,
        i.actorId,
        action,
        id,
        i.caseId ?? null,
        JSON.stringify(changes),
      ],
    );
  }
  private async rowForIdentity(
    i: VerifiedIdentity,
    m: DataSource | EntityManager = this.db,
  ) {
    if (i.role === 'client') {
      const c = await this.clientContext(i, m);
      return (
        (
          await m.query(
            `SELECT * FROM public.client_kyc WHERE organization_id=$1 AND client_id=$2`,
            [i.organizationId, c.client_id],
          )
        )[0] ?? null
      );
    }
    this.reviewer(i);
    return null;
  }
  async mine(i: VerifiedIdentity) {
    const row = await this.rowForIdentity(i);
    if (!row) return { status: 'not_started', requirements: [], documents: [] };
    return this.detail(row.id, i);
  }
  async start(body: Payload, i: VerifiedIdentity) {
    const context = await this.clientContext(i);
    const legalName = this.text(
      body.legal_name ?? context.name,
      'legal_name',
      200,
    );
    const dob =
      typeof body.date_of_birth === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.date_of_birth)
        ? body.date_of_birth
        : null;
    const address =
      typeof body.address_line === 'string'
        ? body.address_line.trim().slice(0, 500)
        : [context.address, context.city, context.state, context.zip_code]
            .filter(Boolean)
            .join(', ') || null;
    const country =
      typeof body.country === 'string'
        ? body.country.trim().slice(0, 120)
        : (context.country ?? null);
    return this.db.transaction(async (m) => {
      const existing = await m.query(
        `SELECT id FROM public.client_kyc WHERE organization_id=$1 AND client_id=$2 FOR UPDATE`,
        [i.organizationId, context.client_id],
      );
      if (existing[0]) throw new ConflictException('KYC record already exists');
      const rows = await m.query(
        `INSERT INTO public.client_kyc(organization_id,client_id,related_case_id,legal_name,date_of_birth,address_line,country,status) VALUES($1,$2,$3,$4,$5,$6,$7,'pending_submission') RETURNING *`,
        [
          i.organizationId,
          context.client_id,
          context.case_id,
          legalName,
          dob,
          address,
          country,
        ],
      );
      const id = rows[0].id;
      await m.query(
        `INSERT INTO public.kyc_requirements(organization_id,kyc_id,requirement_type,title,client_instructions) VALUES($1,$2,'government_photo_id','Government-issued photo ID','Upload a valid passport, driver''s license, national identity card, or other government photo ID.'),($1,$2,'proof_of_address','Proof of address','Upload a recent document that shows your current residential address.')`,
        [i.organizationId, id],
      );
      await m.query(
        `INSERT INTO public.kyc_status_history(organization_id,kyc_id,from_status,to_status,changed_by) VALUES($1,$2,NULL,'pending_submission',$3)`,
        [i.organizationId, id, i.actorId],
      );
      await this.audit(m, i, 'kyc.started', id, {});
      return this.detail(id, i, m);
    });
  }
  async submit(i: VerifiedIdentity) {
    const row = await this.rowForIdentity(i);
    if (!row) throw new NotFoundException('KYC record not found');
    return this.db.transaction(async (m) => {
      const requirements = await m.query(
        `SELECT required,status,current_document_id FROM public.kyc_requirements WHERE kyc_id=$1 AND organization_id=$2`,
        [row.id, i.organizationId],
      );
      if (requirements.some((r: Row) => r.required && !r.current_document_id))
        throw new ConflictException(
          'all required KYC documents must be uploaded',
        );
      if (requirements.some((r: Row) => r.required && r.status === 'rejected'))
        throw new ConflictException('rejected KYC documents must be replaced');
      const updated = (
        await m.query(
          `UPDATE public.client_kyc SET status='pending_submission',submitted_at=now(),client_action_reason=NULL,updated_at=now() WHERE id=$1 AND organization_id=$2 AND status IN ('pending_submission','more_information_required','rejected','expired') RETURNING *`,
          [row.id, i.organizationId],
        )
      )[0];
      if (!updated)
        throw new ConflictException(
          'KYC record cannot be submitted in its current state',
        );
      await m.query(
        `INSERT INTO public.kyc_status_history(organization_id,kyc_id,from_status,to_status,changed_by) VALUES($1,$2,$3,'pending_submission',$4)`,
        [i.organizationId, row.id, row.status, i.actorId],
      );
      await this.audit(m, i, 'kyc.submitted', row.id, {});
      return updated;
    });
  }
  async upload(requirementId: string, body: Payload, i: VerifiedIdentity) {
    const row = await this.rowForIdentity(i);
    if (!row) throw new NotFoundException('KYC record not found');
    const type = this.text(body.document_type, 'document_type', 80);
    if (!TYPES.includes(type))
      throw new BadRequestException('unsupported KYC document type');
    const mime = this.text(body.mime_type, 'mime_type', 100).toLowerCase();
    if (!MIME.includes(mime))
      throw new BadRequestException(
        'only PDF, JPEG, or PNG identity documents are accepted',
      );
    const original = this.text(body.file_name, 'file_name', 255).replace(
      /[\r\n]/g,
      ' ',
    );
    const encoded = this.text(
      body.content_base64,
      'content_base64',
      12_000_000,
    );
    let bytes: Buffer;
    try {
      bytes = Buffer.from(encoded, 'base64');
    } catch {
      throw new BadRequestException('invalid file encoding');
    }
    if (!bytes.length || bytes.length > MAX_FILE)
      throw new BadRequestException('KYC file must be between 1 byte and 8 MB');
    if (!this.magic(bytes, mime))
      throw new BadRequestException(
        'file content does not match the declared type',
      );
    const reqs = await this.db.query(
      `SELECT * FROM public.kyc_requirements WHERE id=$1 AND kyc_id=$2 AND organization_id=$3`,
      [requirementId, row.id, i.organizationId],
    );
    const req = reqs[0];
    if (!req) throw new NotFoundException('KYC requirement not found');
    if (!['missing', 'rejected', 'submitted'].includes(req.status))
      throw new ConflictException(
        'KYC requirement is not accepting a document',
      );
    if (
      req.requirement_type === 'government_photo_id' &&
      ![
        'passport',
        'drivers_license',
        'national_identity_card',
        'government_photo_id',
        'other',
      ].includes(type)
    )
      throw new BadRequestException(
        'document type does not satisfy the photo ID requirement',
      );
    if (
      req.requirement_type === 'proof_of_address' &&
      !['proof_of_address', 'bank_statement', 'other'].includes(type)
    )
      throw new BadRequestException(
        'document type does not satisfy proof of address',
      );
    const key = `${i.organizationId}/${row.id}/${randomUUID()}`,
      path = join(this.root(), key),
      hash = createHash('sha256').update(bytes).digest('hex');
    await mkdir(join(this.root(), i.organizationId, row.id), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    try {
      return await this.db.transaction(async (m) => {
        const docs = await m.query(
          `INSERT INTO public.documents(case_id,organization_id,title,document_type,file_url,file_name,file_size,document_status,is_client_visible,uploaded_by,uploaded_at,mime_type,metadata) VALUES($1,$2,$3,'kyc_protected',NULL,$4,$5,'submitted',false,$6,now(),$7,$8::jsonb) RETURNING id`,
          [
            row.related_case_id,
            i.organizationId,
            req.title,
            original,
            bytes.length,
            i.actorId,
            mime,
            JSON.stringify({ kyc_protected: true }),
          ],
        );
        const linked = await m.query(
          `INSERT INTO public.kyc_documents(organization_id,kyc_id,requirement_id,client_id,related_case_id,document_id,document_type,storage_key,original_file_name,mime_type,file_size,sha256,status,document_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'submitted',$13) RETURNING id,document_type,original_file_name,mime_type,file_size,status,created_at`,
          [
            i.organizationId,
            row.id,
            requirementId,
            row.client_id,
            row.related_case_id,
            docs[0].id,
            type,
            key,
            original,
            mime,
            bytes.length,
            hash,
            body.document_expires_at ?? null,
          ],
        );
        await m.query(
          `UPDATE public.kyc_requirements SET current_document_id=$2,status='submitted',client_action_reason=NULL,reviewed_by=NULL,reviewed_at=NULL,updated_at=now() WHERE id=$1`,
          [requirementId, linked[0].id],
        );
        await this.audit(m, i, 'kyc.document.submitted', row.id, {
          requirement_id: requirementId,
          kyc_document_id: linked[0].id,
          document_type: type,
          file_size: bytes.length,
        });
        return linked[0];
      });
    } catch (e) {
      await unlink(path).catch(() => undefined);
      throw e;
    }
  }
  async list(i: VerifiedIdentity) {
    this.reviewer(i);
    return this.db.query(
      `SELECT k.id,k.client_id,k.related_case_id,k.status,k.legal_name,k.submitted_at,k.reviewed_at,k.verified_at,k.expires_at,k.reviewer_id,k.client_action_reason,k.created_at,k.updated_at,c.case_number,cl.name client_name,o.name organization,u.name reviewer_name,(SELECT count(*) FROM public.kyc_requirements r WHERE r.kyc_id=k.id AND r.required) required_count,(SELECT count(*) FROM public.kyc_requirements r WHERE r.kyc_id=k.id AND r.required AND r.status='verified') verified_count FROM public.client_kyc k JOIN public.clients cl ON cl.id=k.client_id JOIN public.organizations o ON o.id=k.organization_id LEFT JOIN public.cases c ON c.id=k.related_case_id LEFT JOIN public.app_users u ON u.id=k.reviewer_id WHERE k.organization_id=$1 ORDER BY coalesce(k.submitted_at,k.created_at) DESC`,
      [i.organizationId],
    );
  }
  async detail(
    id: string,
    i: VerifiedIdentity,
    m: DataSource | EntityManager = this.db,
  ) {
    let rows: Row[];
    if (i.role === 'client') {
      const c = await this.clientContext(i, m);
      rows = await m.query(
        `SELECT k.id,k.client_id,k.related_case_id,k.status,k.legal_name,k.date_of_birth,k.address_line,k.country,k.submitted_at,k.reviewed_at,k.verified_at,k.expires_at,k.client_action_reason,k.created_at,k.updated_at FROM public.client_kyc k WHERE k.id=$1 AND k.organization_id=$2 AND k.client_id=$3`,
        [id, i.organizationId, c.client_id],
      );
    } else {
      this.reviewer(i);
      rows = await m.query(
        `SELECT k.*,c.case_number,cl.name client_name,o.name organization,u.name reviewer_name FROM public.client_kyc k JOIN public.clients cl ON cl.id=k.client_id JOIN public.organizations o ON o.id=k.organization_id LEFT JOIN public.cases c ON c.id=k.related_case_id LEFT JOIN public.app_users u ON u.id=k.reviewer_id WHERE k.id=$1 AND k.organization_id=$2`,
        [id, i.organizationId],
      );
    }
    if (!rows[0]) throw new NotFoundException('KYC record not found');
    const requirements = await m.query(
      `SELECT r.id,r.requirement_type,r.title,r.required,r.status,r.client_instructions,r.client_action_reason,r.reviewed_at,d.id document_id,d.document_type,d.original_file_name,d.mime_type,d.file_size,d.status document_status,d.document_expires_at,d.created_at uploaded_at ${i.role === 'client' ? '' : ',u.name reviewer_name'} FROM public.kyc_requirements r LEFT JOIN public.kyc_documents d ON d.id=r.current_document_id ${i.role === 'client' ? '' : 'LEFT JOIN public.app_users u ON u.id=r.reviewed_by'} WHERE r.kyc_id=$1 AND r.organization_id=$2 ORDER BY r.created_at`,
      [id, i.organizationId],
    );
    const history =
      i.role === 'client'
        ? []
        : await m.query(
            `SELECT h.from_status,h.to_status,h.client_action_reason,h.created_at,u.name changed_by_name FROM public.kyc_status_history h LEFT JOIN public.app_users u ON u.id=h.changed_by WHERE h.kyc_id=$1 AND h.organization_id=$2 ORDER BY h.created_at`,
            [id, i.organizationId],
          );
    return { ...rows[0], requirements, history };
  }
  async reviewDocument(id: string, body: Payload, i: VerifiedIdentity) {
    this.reviewer(i);
    const action = this.text(body.status, 'status', 50);
    if (!['under_review', 'verified', 'rejected'].includes(action))
      throw new BadRequestException('invalid KYC document status');
    const reason =
      typeof body.client_action_reason === 'string'
        ? body.client_action_reason.trim() || null
        : null;
    if (action === 'rejected' && !reason)
      throw new BadRequestException(
        'client resubmission instructions are required',
      );
    return this.db.transaction(async (m) => {
      const docs = await m.query(
        `SELECT d.*,r.status requirement_status,k.status kyc_status FROM public.kyc_documents d JOIN public.kyc_requirements r ON r.id=d.requirement_id JOIN public.client_kyc k ON k.id=d.kyc_id WHERE d.id=$1 AND d.organization_id=$2 FOR UPDATE`,
        [id, i.organizationId],
      );
      const doc = docs[0];
      if (!doc) throw new NotFoundException('KYC document not found');
      if (!['submitted', 'under_review'].includes(doc.status))
        throw new ConflictException('KYC document review is already complete');
      await m.query(
        `UPDATE public.kyc_documents SET status=$3,reviewed_by=$4,reviewed_at=now(),client_action_reason=$5,updated_at=now() WHERE id=$1 AND organization_id=$2`,
        [id, i.organizationId, action, i.actorId, reason],
      );
      await m.query(
        `UPDATE public.kyc_requirements SET status=$2,reviewed_by=$3,reviewed_at=now(),client_action_reason=$4,updated_at=now() WHERE id=$1`,
        [doc.requirement_id, action, i.actorId, reason],
      );
      if (action === 'rejected') {
        await m.query(
          `UPDATE public.client_kyc SET status='more_information_required',client_action_reason=$2,reviewer_id=$3,reviewed_at=now(),updated_at=now() WHERE id=$1`,
          [doc.kyc_id, reason, i.actorId],
        );
        if (doc.kyc_status !== 'more_information_required')
          await m.query(
            `INSERT INTO public.kyc_status_history(organization_id,kyc_id,from_status,to_status,client_action_reason,changed_by) VALUES($1,$2,$3,'more_information_required',$4,$5)`,
            [i.organizationId, doc.kyc_id, doc.kyc_status, reason, i.actorId],
          );
      }
      await this.audit(m, i, `kyc.document.${action}`, doc.kyc_id, {
        kyc_document_id: id,
        requirement_id: doc.requirement_id,
      });
      return { id, status: action };
    });
  }
  async review(id: string, body: Payload, i: VerifiedIdentity) {
    this.reviewer(i);
    const target = this.text(body.status, 'status', 80),
      reason =
        typeof body.client_action_reason === 'string'
          ? body.client_action_reason.trim() || null
          : null;
    const internal =
      typeof body.internal_review_notes === 'string'
        ? body.internal_review_notes.trim() || null
        : null;
    if (
      ![
        'under_review',
        'more_information_required',
        'verified',
        'rejected',
        'expired',
        'pending_submission',
      ].includes(target)
    )
      throw new BadRequestException('invalid KYC status');
    if (
      ['more_information_required', 'rejected', 'expired'].includes(target) &&
      !reason
    )
      throw new BadRequestException('client-facing reason is required');
    return this.db.transaction(async (m) => {
      const rows = await m.query(
        `SELECT * FROM public.client_kyc WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [id, i.organizationId],
      );
      const row = rows[0];
      if (!row) throw new NotFoundException('KYC record not found');
      const transitions: Record<string, string[]> = {
        pending_submission: [
          'under_review',
          'more_information_required',
          'rejected',
        ],
        under_review: ['verified', 'more_information_required', 'rejected'],
        more_information_required: ['pending_submission', 'rejected'],
        verified: ['expired', 'more_information_required'],
        rejected: ['pending_submission'],
        expired: ['pending_submission'],
      };
      if (!(transitions[row.status] ?? []).includes(target))
        throw new ConflictException(
          `invalid KYC transition ${row.status} -> ${target}`,
        );
      if (target === 'verified') {
        const reqs = await m.query(
          `SELECT r.*,d.status document_status,d.document_expires_at FROM public.kyc_requirements r LEFT JOIN public.kyc_documents d ON d.id=r.current_document_id WHERE r.kyc_id=$1 AND r.organization_id=$2`,
          [id, i.organizationId],
        );
        if (
          reqs.some(
            (r: Row) =>
              r.required &&
              (r.status !== 'verified' ||
                r.document_status !== 'verified' ||
                !r.current_document_id),
          )
        )
          throw new ConflictException(
            'all mandatory KYC requirements and documents must be verified',
          );
        if (
          reqs.some(
            (r: Row) =>
              r.document_expires_at &&
              new Date(r.document_expires_at) < new Date(),
          )
        )
          throw new ConflictException('an identity document is expired');
      }
      const updated = (
        await m.query(
          `UPDATE public.client_kyc SET status=$3,reviewer_id=$4,reviewed_at=now(),verified_at=CASE WHEN $3='verified' THEN now() ELSE verified_at END,expires_at=CASE WHEN $3='verified' THEN $5::timestamptz ELSE expires_at END,client_action_reason=$6,internal_review_notes=COALESCE($7,internal_review_notes),updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING *`,
          [
            id,
            i.organizationId,
            target,
            i.actorId,
            body.expires_at ?? null,
            reason,
            internal,
          ],
        )
      )[0];
      await m.query(
        `INSERT INTO public.kyc_status_history(organization_id,kyc_id,from_status,to_status,client_action_reason,changed_by) VALUES($1,$2,$3,$4,$5,$6)`,
        [i.organizationId, id, row.status, target, reason, i.actorId],
      );
      await this.audit(m, i, `kyc.status.${target}`, id, {
        from: row.status,
        to: target,
        expires_at: target === 'verified' ? (body.expires_at ?? null) : null,
      });
      return updated;
    });
  }
  async download(id: string, i: VerifiedIdentity) {
    let rows;
    if (i.role === 'client') {
      const c = await this.clientContext(i);
      rows = await this.db.query(
        `SELECT d.storage_key,d.original_file_name,d.mime_type FROM public.kyc_documents d JOIN public.client_kyc k ON k.id=d.kyc_id WHERE d.id=$1 AND d.organization_id=$2 AND d.client_id=$3`,
        [id, i.organizationId, c.client_id],
      );
    } else {
      this.reviewer(i);
      rows = await this.db.query(
        `SELECT storage_key,original_file_name,mime_type FROM public.kyc_documents WHERE id=$1 AND organization_id=$2`,
        [id, i.organizationId],
      );
    }
    if (!rows[0]) throw new NotFoundException('KYC document not found');
    const file = await readFile(join(this.root(), rows[0].storage_key)).catch(
      () => {
        throw new NotFoundException('KYC document content not found');
      },
    );
    await this.audit(this.db, i, 'kyc.document.accessed', id, {});
    return {
      file,
      fileName: String(rows[0].original_file_name).replace(/["\r\n]/g, '_'),
      mimeType: rows[0].mime_type,
    };
  }
  private magic(b: Buffer, mime: string) {
    if (mime === 'application/pdf')
      return b.subarray(0, 5).toString() === '%PDF-';
    if (mime === 'image/png')
      return b
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (mime === 'image/jpeg')
      return (
        b[0] === 0xff &&
        b[1] === 0xd8 &&
        b[b.length - 2] === 0xff &&
        b[b.length - 1] === 0xd9
      );
    return false;
  }
}
