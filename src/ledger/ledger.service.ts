import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

@Injectable()
export class LedgerService {
  constructor(@InjectDataSource() private readonly data: DataSource) {}
  findAll(i: VerifiedIdentity) {
    return this.data.query(
      `SELECT p.id,p.invoice_id,i.invoice_number,i.case_id,c.case_number,p.amount,p.payment_method,p.reference_number,p.verification_status,p.proof_document_id,p.created_at,p.updated_at FROM public.payments p JOIN public.invoices i ON i.id=p.invoice_id AND i.organization_id=p.organization_id JOIN public.cases c ON c.id=i.case_id AND c.organization_id=p.organization_id WHERE p.organization_id=$1 ORDER BY p.created_at DESC`,
      [i.organizationId],
    );
  }
  async findOne(id: string, i: VerifiedIdentity) {
    const r = await this.data.query(
      `SELECT p.id,p.invoice_id,i.invoice_number,i.case_id,c.case_number,p.amount,p.payment_method,p.reference_number,p.verification_status,p.proof_document_id,p.created_at,p.updated_at FROM public.payments p JOIN public.invoices i ON i.id=p.invoice_id AND i.organization_id=p.organization_id JOIN public.cases c ON c.id=i.case_id AND c.organization_id=p.organization_id WHERE p.id=$1 AND p.organization_id=$2`,
      [id, i.organizationId],
    );
    if (!r[0]) throw new NotFoundException('ledger entry not found');
    return r[0];
  }
  create(): never {
    throw new ForbiddenException(
      'ledger entries originate from authoritative payment records',
    );
  }
  update(): never {
    throw new ForbiddenException('ledger entries are immutable');
  }
  remove(): never {
    throw new ForbiddenException('ledger entries are immutable');
  }
}
