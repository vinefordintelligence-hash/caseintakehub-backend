import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface AuditLogFilters {
  organizationId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  caseId?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogInput {
  organizationId: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  caseId?: string | null;
  changes?: Record<string, unknown> | null;
}

@Injectable()
export class AuditLogsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async create(input: AuditLogInput): Promise<Record<string, unknown>> {
    const rows = await this.dataSource.query<Record<string, unknown>[]>(
      `INSERT INTO public.audit_logs
         (organization_id, user_id, action, resource_type, resource_id, case_id, changes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, action, resource_type, resource_id, case_id, changes, created_at`,
      [
        input.organizationId,
        input.userId,
        input.action,
        input.resourceType,
        input.resourceId,
        input.caseId ?? null,
        input.changes ? JSON.stringify(this.redact(input.changes)) : null,
      ],
    );
    return rows[0];
  }

  private redact(value: unknown, depth = 0): unknown {
    if (depth > 8) return '[REDACTED]';
    if (Array.isArray(value))
      return value.slice(0, 100).map((item) => this.redact(item, depth + 1));
    if (!value || typeof value !== 'object') return value;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    ).slice(0, 100)) {
      result[key] =
        /(?:authorization|cookie|password|secret|token|pin|credential)/i.test(
          key,
        )
          ? '[REDACTED]'
          : this.redact(child, depth + 1);
    }
    return result;
  }

  private buildWhere(filters: AuditLogFilters): {
    where: string;
    params: unknown[];
  } {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const push = (cond: string, value: unknown) => {
      params.push(value);
      clauses.push(`${cond} = $${params.length}`);
    };
    if (filters.organizationId)
      push('a.organization_id', filters.organizationId);
    if (filters.action) push('a.action', filters.action);
    if (filters.resourceType) push('a.resource_type', filters.resourceType);
    if (filters.resourceId) push('a.resource_id', filters.resourceId);
    if (filters.caseId) {
      params.push(filters.caseId);
      const p = `$${params.length}`;
      clauses.push(
        `(a.case_id IN (SELECT c.id FROM public.cases c WHERE c.organization_id=a.organization_id AND (c.id::text=${p} OR upper(c.case_number)=upper(${p}))) OR a.resource_id IN (SELECT c.id FROM public.cases c WHERE c.organization_id=a.organization_id AND (c.id::text=${p} OR upper(c.case_number)=upper(${p}))))`,
      );
    }
    return {
      where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
      params,
    };
  }

  async findAll(
    filters: AuditLogFilters,
  ): Promise<Array<Record<string, unknown>>> {
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
    const offset = Math.max(filters.offset ?? 0, 0);
    const { where, params } = this.buildWhere(filters);
    const rows = await this.dataSource.query<Record<string, unknown>[]>(
      `SELECT a.*, u.name AS user_name, u.email AS user_email
         FROM public.audit_logs a
         LEFT JOIN public.app_users u ON u.id = a.user_id
        ${where}
        ORDER BY a.created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return rows;
  }

  async count(filters: AuditLogFilters): Promise<number> {
    const { where, params } = this.buildWhere(filters);
    const rows = await this.dataSource.query<Array<{ total: number }>>(
      `SELECT count(*)::int AS total FROM public.audit_logs a${where}`,
      params,
    );
    return rows[0]?.total ?? 0;
  }
}
