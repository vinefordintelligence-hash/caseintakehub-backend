import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ClientLoginDto } from './dto/client-login.dto';
import { UpdateClientProfileDto } from './dto/update-client-profile.dto';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { ActivityNotificationService } from '../notifications/activity-notification.service';

export const CLIENT_AUTH_GENERIC_ERROR = 'Unable to verify case access';

const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const BCRYPT_ROUNDS = 10;

export interface ClientSessionContext {
  sub: string;
  role: 'client';
  name: string | null;
  email: string;
  organization_id: string;
  client_id: string;
  case_id: string;
  case_number: string;
  access_token: string;
}

interface ClientAccessRow {
  case_id: string;
  case_number: string;
  case_status: string;
  organization_id: string;
  client_id: string;
  client_name: string | null;
  client_email: string;
  access_id: string | null;
  access_enabled: boolean | null;
  pin_hash: string | null;
  pin_attempts: number;
  pin_locked_until: string | null;
}

interface ActorIdRow {
  id: string;
}

@Injectable()
export class ClientAuthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly jwt: JwtService,
    private readonly auditLogsService: AuditLogsService,
    @Optional() private readonly notifications?: ActivityNotificationService,
  ) {}

  private generic(): never {
    throw new UnauthorizedException(CLIENT_AUTH_GENERIC_ERROR);
  }

  private async recordPinAttempt(
    accessId: string,
    success: boolean,
  ): Promise<number> {
    if (success) {
      await this.dataSource.query(
        `UPDATE public.client_case_access
            SET pin_attempts = 0, pin_locked_until = NULL
          WHERE id = $1`,
        [accessId],
      );
      return 0;
    }

    const rows = await this.dataSource.query<Array<{ pin_attempts: number }>>(
      `UPDATE public.client_case_access
          SET pin_attempts = pin_attempts + 1,
              pin_locked_until = CASE
                WHEN pin_attempts + 1 >= $2 THEN now() + make_interval(mins => $3)
                ELSE pin_locked_until
              END
        WHERE id = $1 RETURNING pin_attempts`,
      [accessId, MAX_PIN_ATTEMPTS, LOCKOUT_MINUTES],
    );
    return Number(rows[0]?.pin_attempts ?? 0);
  }

  /**
   * Validates Case Reference ID + Client Email + 6-digit PIN together.
   * Every failure path returns the identical generic message so the caller
   * cannot tell which value was wrong.
   */
  async login(dto: ClientLoginDto): Promise<ClientSessionContext> {
    const reference = dto.referenceId.trim();
    const email = dto.email.trim().toLowerCase();
    const pin = dto.pin.trim();

    if (!reference || !/^\d{6}$/.test(pin)) {
      this.generic();
    }

    const rows = await this.dataSource.query<ClientAccessRow[]>(
      `SELECT c.id AS case_id, c.case_number, c.status AS case_status,
              c.organization_id,
              cl.id AS client_id, cl.name AS client_name, cl.email AS client_email,
              a.id AS access_id, a.enabled AS access_enabled, a.pin_hash,
              a.pin_attempts, a.pin_locked_until
         FROM public.cases c
         JOIN public.clients cl ON cl.id = c.client_id
         LEFT JOIN public.client_case_access a ON a.case_id = c.id
        WHERE upper(c.case_number) = upper($1)`,
      [reference],
    );

    const row = rows[0];
    if (!row) {
      this.generic();
    }

    const locked =
      row.pin_locked_until !== null &&
      new Date(row.pin_locked_until).getTime() > Date.now();

    if (!row.access_id || !row.access_enabled || locked || !row.pin_hash) {
      this.generic();
    }

    if (row.client_email.toLowerCase() !== email) {
      this.generic();
    }

    if (row.case_status !== 'open') {
      this.generic();
    }

    const pinValid = await bcrypt.compare(pin, row.pin_hash);
    if (!pinValid) {
      const attempts = await this.recordPinAttempt(row.access_id, false);
      if (attempts >= MAX_PIN_ATTEMPTS)
        void this.notifications
          ?.enqueue({
            eventKey: `client.login.lockout:${row.access_id}:${Math.floor(Date.now() / (LOCKOUT_MINUTES * 60_000))}`,
            eventType: 'client.login.failed.threshold',
            category: 'security',
            organizationId: row.organization_id,
            actorType: 'client',
            caseId: row.case_id,
            caseNumber: row.case_number,
            entityType: 'client_case_access',
            entityId: row.access_id,
            title: 'Repeated Client Login Failures',
            description:
              'Client Vault access was temporarily locked after repeated failed authentication attempts.',
            status: 'locked',
          })
          .catch(() => undefined);
      this.generic();
    }

    await this.recordPinAttempt(row.access_id, true);

    const actorRows = await this.dataSource.query<ActorIdRow[]>(
      `SELECT id FROM public.app_users
        WHERE lower(email) = lower($1) AND role = 'client'
        ORDER BY created_at ASC LIMIT 1`,
      [row.client_email],
    );

    const actorId = actorRows[0]?.id;
    if (!actorId) this.generic();
    const accessToken = await this.jwt.signAsync(
      {
        sub: actorId,
        role: 'client',
        organization_id: row.organization_id,
        case_id: row.case_id,
        token_use: 'vineford_client_portal',
      },
      { expiresIn: '1h', algorithm: 'HS256' },
    );

    void this.notifications
      ?.enqueue({
        eventKey: `client.login.success:${row.access_id}:${Date.now()}`,
        eventType: 'client.login.success',
        category: 'client_portal',
        organizationId: row.organization_id,
        actorId,
        actorType: 'client',
        actorName: row.client_name ?? undefined,
        caseId: row.case_id,
        caseNumber: row.case_number,
        entityType: 'client_case_access',
        entityId: row.access_id,
        title: 'Client Vault Login',
        description: 'A client successfully authenticated to the Client Vault.',
        status: 'success',
      })
      .catch(() => undefined);

    return {
      sub: actorId,
      role: 'client',
      name: row.client_name ?? null,
      email: row.client_email,
      organization_id: row.organization_id,
      client_id: row.client_id,
      case_id: row.case_id,
      case_number: row.case_number,
      access_token: accessToken,
    };
  }

  /**
   * Provisions (or re-provisions) the per-case client access record.
   * The raw PIN is never stored; only a bcrypt hash is persisted.
   * Used by operations to enable the intended Reference + Email + PIN
   * access for an existing authorized client of an existing case.
   */
  async provision(
    caseNumber: string,
    email: string,
    pin: string,
    enabled = true,
  ): Promise<{
    case_id: string;
    case_number: string;
    client_id: string;
    enabled: boolean;
  }> {
    if (!/^\d{6}$/.test(pin.trim())) {
      throw new UnauthorizedException('PIN must be exactly 6 digits');
    }

    const rows = await this.dataSource.query<
      Array<{ case_id: string; case_number: string; client_id: string }>
    >(
      `SELECT c.id AS case_id, c.case_number, cl.id AS client_id
         FROM public.cases c
         JOIN public.clients cl ON cl.id = c.client_id
        WHERE upper(c.case_number) = upper($1)
          AND lower(cl.email) = lower($2)`,
      [caseNumber.trim(), email.trim().toLowerCase()],
    );

    const row = rows[0];
    if (!row) {
      throw new UnauthorizedException('case and client do not match');
    }

    const pinHash = await bcrypt.hash(pin.trim(), BCRYPT_ROUNDS);

    await this.dataSource.query(
      `INSERT INTO public.client_case_access
         (client_id, case_id, pin_hash, enabled, pin_set_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (case_id)
       DO UPDATE SET
         client_id = EXCLUDED.client_id,
         pin_hash = EXCLUDED.pin_hash,
         enabled = EXCLUDED.enabled,
         pin_attempts = 0,
         pin_locked_until = NULL,
         pin_set_at = now()`,
      [row.client_id, row.case_id, pinHash, enabled],
    );

    return {
      case_id: row.case_id,
      case_number: row.case_number,
      client_id: row.client_id,
      enabled,
    };
  }

  /**
   * Administrator-initiated PIN reset for an authorized client's case.
   * Stores only the bcrypt hash, clears any lockout, and never returns or
   * records the raw PIN.
   */
  async resetPin(
    caseNumber: string,
    newPin: string,
    confirmPin: string,
    identity: VerifiedIdentity,
  ): Promise<{ case_number: string; success: true }> {
    if (!['admin', 'super_admin'].includes(identity.role))
      throw new ForbiddenException('administrator access required');
    if (!/^\d{6}$/.test(newPin))
      throw new BadRequestException('PIN must be exactly 6 digits');
    if (newPin !== confirmPin)
      throw new BadRequestException('PIN entries must match');

    const rows = await this.dataSource.query<
      Array<{
        case_id: string;
        case_number: string;
        client_id: string;
        organization_id: string;
      }>
    >(
      `SELECT c.id AS case_id, c.case_number, cl.id AS client_id, c.organization_id
         FROM public.cases c
         JOIN public.clients cl ON cl.id = c.client_id
        WHERE upper(c.case_number) = upper($1) AND c.organization_id = $2 AND cl.organization_id = c.organization_id`,
      [caseNumber.trim(), identity.organizationId],
    );

    const row = rows[0];
    if (!row) {
      throw new UnauthorizedException('case not found');
    }

    const pinHash = await bcrypt.hash(newPin, BCRYPT_ROUNDS);

    await this.dataSource.query(
      `INSERT INTO public.client_case_access
         (client_id, case_id, pin_hash, enabled, pin_set_at)
       VALUES ($1, $2, $3, true, now())
       ON CONFLICT (case_id)
       DO UPDATE SET
         pin_hash = EXCLUDED.pin_hash,
         enabled = true,
         pin_attempts = 0,
         pin_locked_until = NULL,
         pin_set_at = now()`,
      [row.client_id, row.case_id, pinHash],
    );

    await this.auditLogsService.create({
      organizationId: row.organization_id,
      userId: identity.actorId,
      action: 'CLIENT_AUTH_PIN_RESET',
      resourceType: 'client',
      resourceId: row.client_id,
      caseId: row.case_id,
      changes: { fields: ['pin'] },
    });

    return { case_number: row.case_number, success: true };
  }

  async updateProfile(
    caseNumber: string,
    dto: UpdateClientProfileDto,
    identity: VerifiedIdentity,
  ) {
    if (!['admin', 'super_admin'].includes(identity.role))
      throw new ForbiddenException('administrator access required');
    const fields: Array<keyof UpdateClientProfileDto> = [
      'name',
      'email',
      'phone',
      'address',
      'city',
      'state',
      'zip_code',
      'country',
    ];
    const updates: string[] = [];
    const values: unknown[] = [];
    for (const field of fields) {
      const value = dto[field];
      if (value === undefined) continue;
      if (
        typeof value === 'string' &&
        !value.trim() &&
        (field === 'name' || field === 'email')
      )
        throw new BadRequestException(`${field} cannot be blank`);
      updates.push(`${field} = $${values.length + 1}`);
      values.push(typeof value === 'string' ? value.trim() : value);
    }
    if (!updates.length)
      throw new BadRequestException('no profile fields supplied');
    const rows = await this.dataSource.query<
      Array<{
        id: string;
        case_number: string;
        client_id: string;
        organization_id: string;
      }>
    >(
      `SELECT c.id,c.case_number,c.client_id,c.organization_id FROM public.cases c JOIN public.clients cl ON cl.id=c.client_id AND cl.organization_id=c.organization_id WHERE upper(c.case_number)=upper($1) AND c.organization_id=$2`,
      [caseNumber.trim(), identity.organizationId],
    );
    if (!rows[0]) throw new UnauthorizedException('case not found');
    values.push(rows[0].client_id, identity.organizationId);
    const updated = await this.dataSource.query(
      `UPDATE public.clients SET ${updates.join(', ')}, updated_at=now() WHERE id=$${values.length - 1} AND organization_id=$${values.length} RETURNING id,name,email,phone,address,city,state,zip_code,country`,
      values,
    );
    if (!updated[0])
      throw new UnauthorizedException('client profile not found');
    await this.auditLogsService.create({
      organizationId: identity.organizationId,
      userId: identity.actorId,
      action: 'CLIENT_PROFILE_UPDATED',
      resourceType: 'client',
      resourceId: rows[0].client_id,
      caseId: rows[0].id,
      changes: { fields: updates.map((entry) => entry.split(' ')[0]) },
    });
    return { case_number: rows[0].case_number, client: updated[0] };
  }
}
