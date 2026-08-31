import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { CreateCustodyEventDto } from './dto/create-custody-event.dto';

@Injectable()
export class CustodyService {
  constructor(@InjectDataSource() private readonly data: DataSource) {}
  list(evidenceId: string, identity: VerifiedIdentity) {
    return this.data.query(
      `SELECT ce.id,ce.evidence_id,ce.action,ce.reason,ce.from_custodian,ce.to_custodian,ce.integrity_hash,ce.metadata,ce.created_at,u.name actor_name FROM public.evidence_custody_events ce JOIN public.evidence e ON e.id=ce.evidence_id AND e.organization_id=ce.organization_id LEFT JOIN public.app_users u ON u.id=ce.actor_id WHERE ce.evidence_id=$1 AND ce.organization_id=$2 ORDER BY ce.created_at ASC`,
      [evidenceId, identity.organizationId],
    );
  }
  async create(dto: CreateCustodyEventDto, identity: VerifiedIdentity) {
    return this.data.transaction(async (manager) => {
      const evidence = (
        await manager.query(
          `SELECT e.id,e.case_id,(SELECT to_custodian FROM public.evidence_custody_events WHERE evidence_id=e.id AND organization_id=e.organization_id ORDER BY created_at DESC LIMIT 1) custodian FROM public.evidence e JOIN public.cases c ON c.id=e.case_id AND c.organization_id=e.organization_id WHERE e.id=$1 AND e.organization_id=$2 FOR UPDATE OF e`,
          [dto.evidence_id, identity.organizationId],
        )
      )[0];
      if (!evidence) throw new NotFoundException('evidence not found');
      if (dto.to_custodian) {
        const user = (
          await manager.query(
            `SELECT id FROM public.app_users WHERE id=$1 AND organization_id=$2 AND is_active=true`,
            [dto.to_custodian, identity.organizationId],
          )
        )[0];
        if (!user) throw new NotFoundException('custodian not found');
      }
      const rows = await manager.query(
        `INSERT INTO public.evidence_custody_events(organization_id,case_id,evidence_id,actor_id,action,reason,from_custodian,to_custodian,integrity_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [
          identity.organizationId,
          evidence.case_id,
          evidence.id,
          identity.actorId,
          dto.action,
          dto.reason.trim(),
          evidence.custodian ?? null,
          dto.to_custodian ?? null,
          dto.integrity_hash?.toLowerCase() ?? null,
        ],
      );
      await manager.query(
        `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,case_id,changes) VALUES($1,$2,'EVIDENCE_CUSTODY_EVENT','evidence',$3,$4,$5)`,
        [
          identity.organizationId,
          identity.actorId,
          evidence.id,
          evidence.case_id,
          JSON.stringify({ custody_event_id: rows[0].id, action: dto.action }),
        ],
      );
      return rows[0];
    });
  }
}
