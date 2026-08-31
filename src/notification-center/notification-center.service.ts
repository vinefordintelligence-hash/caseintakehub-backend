import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ActorService, Actor } from '../common/actor.service';

export interface CreateNotificationInput {
  caseId: string;
  organizationId: string;
  recipientRole: 'client' | 'admin';
  title: string;
  body?: string;
}

@Injectable()
export class NotificationCenterService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly actorService: ActorService,
  ) {}

  async create(
    input: CreateNotificationInput,
  ): Promise<Record<string, unknown>> {
    const rows = await this.dataSource.query<Record<string, unknown>[]>(
      `INSERT INTO public.case_notifications
         (case_id, organization_id, recipient_role, title, body)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, case_id, recipient_role, title, body, is_read, created_at`,
      [
        input.caseId,
        input.organizationId,
        input.recipientRole,
        input.title,
        input.body ?? '',
      ],
    );
    return rows[0];
  }

  async list(
    actor: Actor,
    caseId?: string,
  ): Promise<Record<string, unknown>[]> {
    if (actor.role === 'client') {
      if (!caseId) {
        return [];
      }
      const allowed = await this.canAccessCase(actor.id, caseId);
      if (!allowed) {
        throw new UnauthorizedException(
          'permission denied: actor is not authorized for case',
        );
      }
      return this.dataSource.query<Record<string, unknown>[]>(
        `SELECT id, case_id, title, body, is_read, created_at
           FROM public.case_notifications
          WHERE recipient_role = 'client' AND case_id = $1
          ORDER BY created_at DESC LIMIT 100`,
        [caseId],
      );
    }
    const rows = await this.dataSource.query<Record<string, unknown>[]>(
      `SELECT n.id, n.case_id, c.case_number, n.title, n.body, n.is_read, n.created_at
         FROM public.case_notifications n
         LEFT JOIN public.cases c ON c.id = n.case_id
        WHERE n.recipient_role = 'admin' AND n.organization_id = $1
          ${caseId ? 'AND n.case_id = $2' : ''}
        ORDER BY n.created_at DESC LIMIT 200`,
      caseId ? [actor.organization_id, caseId] : [actor.organization_id],
    );
    return rows;
  }

  async unreadCount(actor: Actor, caseId?: string): Promise<number> {
    if (actor.role === 'client') {
      if (!caseId) {
        return 0;
      }
      const rows = await this.dataSource.query<Array<{ total: number }>>(
        `SELECT count(*)::int AS total
           FROM public.case_notifications
          WHERE recipient_role = 'client' AND case_id = $1 AND NOT is_read`,
        [caseId],
      );
      return rows[0]?.total ?? 0;
    }
    const rows = await this.dataSource.query<Array<{ total: number }>>(
      `SELECT count(*)::int AS total
         FROM public.case_notifications
        WHERE recipient_role = 'admin' AND organization_id = $1 AND NOT is_read
          ${caseId ? 'AND case_id = $2' : ''}`,
      caseId ? [actor.organization_id, caseId] : [actor.organization_id],
    );
    return rows[0]?.total ?? 0;
  }

  async markRead(
    id: string,
    actor: Actor,
    caseId?: string,
  ): Promise<{ ok: boolean }> {
    if (actor.role === 'client') {
      if (!caseId) {
        throw new UnauthorizedException(
          'permission denied: case context required',
        );
      }
      await this.dataSource.query(
        `UPDATE public.case_notifications
            SET is_read = true
          WHERE id = $1 AND recipient_role = 'client' AND case_id = $2`,
        [id, caseId],
      );
    } else {
      await this.dataSource.query(
        `UPDATE public.case_notifications
            SET is_read = true
          WHERE id = $1 AND organization_id = $2`,
        [id, actor.organization_id],
      );
    }
    return { ok: true };
  }

  async markAllRead(actor: Actor, caseId?: string): Promise<{ ok: boolean }> {
    if (actor.role === 'client') {
      if (!caseId) {
        throw new UnauthorizedException(
          'permission denied: case context required',
        );
      }
      await this.dataSource.query(
        `UPDATE public.case_notifications
            SET is_read = true
          WHERE recipient_role = 'client' AND case_id = $1`,
        [caseId],
      );
    } else {
      await this.dataSource.query(
        `UPDATE public.case_notifications
            SET is_read = true
          WHERE recipient_role = 'admin' AND organization_id = $1
            ${caseId ? 'AND case_id = $2' : ''}`,
        caseId ? [actor.organization_id, caseId] : [actor.organization_id],
      );
    }
    return { ok: true };
  }

  private async canAccessCase(
    actorId: string,
    caseId: string,
  ): Promise<boolean> {
    const rows = await this.dataSource.query<Array<{ allowed: boolean }>>(
      `SELECT public.vf_actor_can_access_case($1,$2) AS allowed`,
      [actorId, caseId],
    );
    return rows[0]?.allowed === true;
  }
}
