import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

export interface ActivityEvent {
  eventKey: string;
  eventType: string;
  category: string;
  organizationId?: string;
  actorId?: string;
  actorType?: string;
  actorName?: string;
  caseId?: string;
  caseNumber?: string;
  entityType: string;
  entityId?: string;
  entityReference?: string;
  title: string;
  description: string;
  status?: string;
  occurredAt?: Date;
}

type OutboxRow = Record<string, any>;
const CATEGORIES = [
  'intake',
  'case',
  'client_portal',
  'kyc',
  'documents',
  'messages',
  'financial',
  'security',
  'administration',
];

@Injectable()
export class ActivityNotificationService {
  private readonly logger = new Logger(ActivityNotificationService.name);
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly config: ConfigService,
  ) {}

  async enqueue(event: ActivityEvent): Promise<boolean> {
    const rows = await this.db.query(
      `INSERT INTO public.activity_notification_outbox(event_key,event_type,category,occurred_at,organization_id,actor_id,actor_type,actor_name,case_id,case_number,entity_type,entity_id,entity_reference,title,description,activity_status)
       VALUES($1,$2,$3,coalesce($4,now()),$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT(event_key) DO NOTHING RETURNING id`,
      [
        event.eventKey,
        event.eventType,
        event.category,
        event.occurredAt ?? null,
        event.organizationId ?? null,
        event.actorId ?? null,
        event.actorType ?? null,
        this.safe(event.actorName),
        event.caseId ?? null,
        this.safe(event.caseNumber),
        event.entityType,
        this.safe(event.entityId),
        this.safe(event.entityReference),
        this.safe(event.title) ?? 'VINEFORD activity',
        this.safe(event.description) ?? 'A meaningful activity occurred.',
        this.safe(event.status),
      ],
    );
    return Boolean(rows[0]);
  }

  @Interval(15_000)
  async processPending(): Promise<void> {
    let rows: OutboxRow[] = [];
    try {
      const claimed = await this.db
        .query(`UPDATE public.activity_notification_outbox SET delivery_status='processing',attempts=attempts+1,updated_at=now()
        WHERE id IN (SELECT id FROM public.activity_notification_outbox WHERE delivery_status IN ('pending','failed') AND next_attempt_at<=now() AND attempts<6 ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED)
        RETURNING *`);
      rows = (Array.isArray(claimed?.[0]) ? claimed[0] : claimed).filter(
        (row: OutboxRow) => Boolean(row?.id),
      );
    } catch (error) {
      if ((error as { code?: string }).code !== '42P01')
        this.logger.warn('Activity notification queue claim failed');
      return;
    }
    for (const row of rows) await this.deliver(row);
  }

  async getSettings(identity: VerifiedIdentity) {
    this.admin(identity);
    const rows = await this.db.query(
      `SELECT organization_id,enabled,recipient_email,categories,delivery_mode,updated_at FROM public.activity_notification_settings WHERE organization_id=$1`,
      [identity.organizationId],
    );
    return (
      rows[0] ?? {
        organization_id: identity.organizationId,
        enabled: true,
        recipient_email: null,
        categories: Object.fromEntries(CATEGORIES.map((v) => [v, true])),
        delivery_mode: 'immediate',
        updated_at: null,
      }
    );
  }

  async updateSettings(
    body: Record<string, unknown>,
    identity: VerifiedIdentity,
  ) {
    this.admin(identity);
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : true;
    const email =
      typeof body.recipient_email === 'string' && body.recipient_email.trim()
        ? body.recipient_email.trim().toLowerCase()
        : null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new ForbiddenException('valid notification recipient required');
    const requested =
      body.categories && typeof body.categories === 'object'
        ? (body.categories as Record<string, unknown>)
        : {};
    const categories = Object.fromEntries(
      CATEGORIES.map((key) => [key, requested[key] !== false]),
    );
    const mode = body.delivery_mode === 'digest' ? 'digest' : 'immediate';
    const rows = await this.db.query(
      `INSERT INTO public.activity_notification_settings(organization_id,enabled,recipient_email,categories,delivery_mode,updated_by)
      VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT(organization_id) DO UPDATE SET enabled=excluded.enabled,recipient_email=excluded.recipient_email,categories=excluded.categories,delivery_mode=excluded.delivery_mode,updated_by=excluded.updated_by,updated_at=now()
      RETURNING organization_id,enabled,recipient_email,categories,delivery_mode,updated_at`,
      [
        identity.organizationId,
        enabled,
        email,
        JSON.stringify(categories),
        mode,
        identity.actorId,
      ],
    );
    await this.db.query(
      `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,changes) VALUES($1,$2,'NOTIFICATION_SETTINGS_CHANGED','activity_notification_settings',$1,jsonb_build_object('enabled',$3,'delivery_mode',$4))`,
      [identity.organizationId, identity.actorId, enabled, mode],
    );
    return rows[0];
  }

  private async deliver(row: OutboxRow): Promise<void> {
    try {
      const settingRows = row.organization_id
        ? await this.db.query(
            `SELECT enabled,recipient_email,categories,delivery_mode FROM public.activity_notification_settings WHERE organization_id=$1`,
            [row.organization_id],
          )
        : [];
      const setting = settingRows[0];
      if (
        setting?.enabled === false ||
        setting?.categories?.[row.category] === false ||
        (setting?.delivery_mode === 'digest' &&
          !['security'].includes(row.category))
      )
        return this.skip(row.id, 'disabled by notification settings');
      const recipient =
        setting?.recipient_email ||
        this.config.get<string>('VINEFORD_ACTIVITY_NOTIFICATION_EMAIL') ||
        (await this.adminRecipient(row.organization_id));
      if (!recipient)
        throw new Error('notification recipient is not configured');
      const from = this.config.get<string>('FROM_EMAIL');
      if (!from) throw new Error('Resend sender is not configured');
      const context = await this.context(row);
      await this.sendWithResend({
        from,
        to: recipient,
        subject: `[VINEFORD] ${row.title}${context.reference ? ` — ${context.reference}` : ''}`,
        text: this.body(row, context),
      });
      await this.db.query(
        `UPDATE public.activity_notification_outbox SET delivery_status='sent',recipient_email=$2,sent_at=now(),last_error=NULL,updated_at=now() WHERE id=$1`,
        [row.id, recipient],
      );
    } catch (error) {
      const message = this.safeError(error);
      await this.db
        .query(
          `UPDATE public.activity_notification_outbox SET delivery_status='failed',last_error=$2,next_attempt_at=now()+make_interval(secs=>least(3600,power(2,attempts)::int*30)),updated_at=now() WHERE id=$1`,
          [row.id, message],
        )
        .catch(() => undefined);
      this.logger.warn(`Activity email delivery failed for event ${row.id}`);
    }
  }

  private async sendWithResend(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<void> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) throw new Error('Resend transport is not configured');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ ...message, to: [message.to] }),
    });
    if (!response.ok)
      throw new Error(`Resend delivery request failed (${response.status})`);
    const result = (await response.json().catch(() => null)) as {
      id?: unknown;
    } | null;
    if (typeof result?.id !== 'string')
      throw new Error('Resend did not accept the delivery request');
  }

  private async adminRecipient(org?: string): Promise<string | null> {
    if (!org) return null;
    const rows = await this.db.query(
      `SELECT email FROM public.app_users WHERE organization_id=$1 AND is_active=true AND role IN ('super_admin','admin') AND email IS NOT NULL ORDER BY CASE role WHEN 'super_admin' THEN 0 ELSE 1 END,created_at LIMIT 1`,
      [org],
    );
    return rows[0]?.email ?? null;
  }
  private async context(row: OutboxRow) {
    let reference = row.entity_reference ?? row.case_number ?? null,
      organization: string | null = null,
      actor = row.actor_name ?? row.actor_type ?? 'System';
    if (row.organization_id) {
      const r = await this.db.query(
        `SELECT name FROM public.organizations WHERE id=$1`,
        [row.organization_id],
      );
      organization = r[0]?.name ?? null;
    }
    if (row.actor_id) {
      const r = await this.db.query(
        `SELECT name FROM public.app_users WHERE id=$1`,
        [row.actor_id],
      );
      actor = r[0]?.name ?? actor;
    }
    if (row.case_id) {
      const r = await this.db.query(
        `SELECT case_number FROM public.cases WHERE id=$1 AND ($2::uuid IS NULL OR organization_id=$2)`,
        [row.case_id, row.organization_id],
      );
      reference = r[0]?.case_number ?? reference;
    }
    return { reference, organization, actor };
  }
  private body(
    row: OutboxRow,
    c: { reference: string | null; organization: string | null; actor: string },
  ) {
    const base = (
      this.config.get<string>('VINEFORD_PUBLIC_URL') ??
      'https://vinefordintelligence.com'
    ).replace(/\/$/, '');
    const link = this.link(base, row, c.reference);
    return [
      row.description,
      '',
      `Event: ${row.event_type}`,
      `Time: ${new Date(row.occurred_at).toISOString()}`,
      `Environment: ${this.config.get<string>('NODE_ENV') ?? 'unknown'}`,
      `Actor: ${c.actor}`,
      c.reference ? `Reference: ${c.reference}` : null,
      c.organization ? `Organization: ${c.organization}` : null,
      row.activity_status ? `Status: ${row.activity_status}` : null,
      row.entity_id ? `Record ID: ${row.entity_id}` : null,
      '',
      `View in Admin: ${link}`,
    ]
      .filter((v) => v !== null)
      .join('\n');
  }
  private link(base: string, row: OutboxRow, reference: string | null) {
    if (row.category === 'intake' && row.entity_id)
      return `${base}/admin/assessments/${encodeURIComponent(row.entity_id)}`;
    if (row.category === 'kyc') return `${base}/admin/kyc`;
    if (reference)
      return `${base}/admin/cases/${encodeURIComponent(reference)}`;
    return `${base}/admin/audit`;
  }
  private skip(id: string, reason: string) {
    return this.db
      .query(
        `UPDATE public.activity_notification_outbox SET delivery_status='skipped',last_error=$2,updated_at=now() WHERE id=$1`,
        [id, reason],
      )
      .then(() => undefined);
  }
  private safe(v: unknown) {
    if (typeof v !== 'string') return null;
    return v.replace(/[\r\n\0]/g, ' ').slice(0, 500);
  }
  private safeError(error: unknown) {
    const message = error instanceof Error ? error.message : 'delivery failed';
    return /password|secret|token|credential|pin/i.test(message)
      ? 'notification delivery configuration error'
      : message.slice(0, 500);
  }
  private admin(identity: VerifiedIdentity) {
    if (!['admin', 'super_admin'].includes(identity.role))
      throw new ForbiddenException('administrator access required');
  }
}
