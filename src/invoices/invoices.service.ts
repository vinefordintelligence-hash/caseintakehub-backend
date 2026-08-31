import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

@Injectable()
export class InvoicesService {
  constructor(@InjectDataSource() private readonly data: DataSource) {}
  async create(dto: CreateInvoiceDto, i: VerifiedIdentity) {
    if (dto.status && !['draft', 'sent'].includes(dto.status))
      throw new BadRequestException('new invoice status must be draft or sent');
    return this.data.transaction(async (m) => {
      const c = (
        await m.query(
          'SELECT id,client_id FROM public.cases WHERE id=$1 AND organization_id=$2',
          [dto.case_id, i.organizationId],
        )
      )[0];
      if (!c) throw new NotFoundException('case not found');
      const num =
        dto.invoice_number?.trim() ||
        `INV-${new Date().getUTCFullYear()}-${randomBytes(5).toString('hex').toUpperCase()}`;
      const r = await m.query(
        `INSERT INTO public.invoices(organization_id,client_id,case_id,invoice_number,amount,status,due_date)VALUES($1,$2,$3,$4,$5,$6,$7::date)RETURNING *`,
        [
          i.organizationId,
          c.client_id,
          c.id,
          num,
          dto.amount,
          dto.status ?? 'draft',
          dto.due_date ?? null,
        ],
      );
      await this.audit(m, i, 'INVOICE_CREATED', r[0]);
      return r[0];
    });
  }
  findAll(i: VerifiedIdentity) {
    return this.data.query(
      `SELECT i.*,c.case_number,COALESCE(sum(p.amount),0) recorded_payments FROM public.invoices i JOIN public.cases c ON c.id=i.case_id AND c.organization_id=i.organization_id LEFT JOIN public.payments p ON p.invoice_id=i.id AND p.organization_id=i.organization_id WHERE i.organization_id=$1 GROUP BY i.id,c.case_number ORDER BY i.created_at DESC`,
      [i.organizationId],
    );
  }
  async findOne(id: string, i: VerifiedIdentity) {
    const r = await this.data.query(
      `SELECT i.*,c.case_number,COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'amount',p.amount,'reference_number',p.reference_number,'verification_status',p.verification_status,'created_at',p.created_at))FILTER(WHERE p.id IS NOT NULL),'[]'::jsonb)payments FROM public.invoices i JOIN public.cases c ON c.id=i.case_id AND c.organization_id=i.organization_id LEFT JOIN public.payments p ON p.invoice_id=i.id AND p.organization_id=i.organization_id WHERE i.id=$1 AND i.organization_id=$2 GROUP BY i.id,c.case_number`,
      [id, i.organizationId],
    );
    if (!r[0]) throw new NotFoundException('invoice not found');
    return r[0];
  }
  async update(id: string, dto: UpdateInvoiceDto, i: VerifiedIdentity) {
    return this.data.transaction(async (m) => {
      const before = (
        await m.query(
          `SELECT i.*,EXISTS(SELECT 1 FROM public.payments p WHERE p.invoice_id=i.id AND p.organization_id=i.organization_id) has_payment FROM public.invoices i WHERE i.id=$1 AND i.organization_id=$2 FOR UPDATE`,
          [id, i.organizationId],
        )
      )[0];
      if (!before) throw new NotFoundException('invoice not found');
      if (
        before.has_payment &&
        (dto.amount !== undefined || dto.status !== undefined)
      )
        throw new BadRequestException(
          'invoice with recorded payment cannot change amount or status',
        );
      if (
        dto.status &&
        !['draft', 'sent', 'overdue', 'cancelled'].includes(dto.status)
      )
        throw new BadRequestException(
          'paid status is derived from verified payment records',
        );
      const r = await m.query(
        `UPDATE public.invoices SET amount=COALESCE($1,amount),status=COALESCE($2,status),due_date=CASE WHEN $3 THEN $4::date ELSE due_date END,updated_at=now()WHERE id=$5 AND organization_id=$6 RETURNING *`,
        [
          dto.amount ?? null,
          dto.status ?? null,
          dto.due_date !== undefined,
          dto.due_date ?? null,
          id,
          i.organizationId,
        ],
      );
      await this.audit(m, i, 'INVOICE_UPDATED', r[0]);
      return r[0];
    });
  }
  remove(id: string, i: VerifiedIdentity) {
    return this.update(id, { status: 'cancelled' }, i);
  }
  private audit(
    m: { query: (s: string, p?: unknown[]) => Promise<any[]> },
    i: VerifiedIdentity,
    action: string,
    row: any,
  ) {
    return m.query(
      `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,case_id,changes)VALUES($1,$2,$3,'invoice',$4,$5,$6)`,
      [
        i.organizationId,
        i.actorId,
        action,
        row.id,
        row.case_id,
        JSON.stringify({ status: row.status, amount: row.amount }),
      ],
    );
  }
}
