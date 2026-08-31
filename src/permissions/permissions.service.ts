import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

export const PERMISSION_DEFINITIONS = [
  'cases.read',
  'cases.create',
  'cases.update',
  'cases.assign',
  'documents.read',
  'documents.upload',
  'documents.verify',
  'evidence.read',
  'evidence.manage',
  'messages.read',
  'messages.send',
  'reports.read',
  'reports.generate',
  'audit.read',
  'audit.write',
  'users.read',
  'users.manage',
  'organizations.read',
  'organizations.manage',
] as const;
export type PermissionName = (typeof PERMISSION_DEFINITIONS)[number];

export const SYSTEM_PERMISSION_MATRIX: Record<string, readonly string[]> = {
  super_admin: ['*'],
  admin: [...PERMISSION_DEFINITIONS],
  investigator: [
    'cases.read',
    'cases.create',
    'cases.update',
    'cases.assign',
    'documents.read',
    'documents.upload',
    'documents.verify',
    'evidence.read',
    'evidence.manage',
    'messages.read',
    'messages.send',
    'reports.read',
    'reports.generate',
    'users.read',
    'organizations.read',
  ],
  financial_analyst: [
    'cases.read',
    'documents.read',
    'evidence.read',
    'messages.read',
    'messages.send',
    'reports.read',
    'reports.generate',
    'users.read',
    'organizations.read',
  ],
  staff: [
    'cases.read',
    'documents.read',
    'documents.upload',
    'evidence.read',
    'messages.read',
    'messages.send',
    'reports.read',
    'users.read',
    'organizations.read',
  ],
  client: [
    'cases.read',
    'documents.read',
    'documents.upload',
    'evidence.read',
    'messages.read',
    'messages.send',
    'reports.read',
  ],
};

type PermissionUpdate = { permissions?: unknown };
type QuerySource = {
  query<T = unknown>(query: string, parameters?: unknown[]): Promise<T>;
};

@Injectable()
export class PermissionsService {
  constructor(@InjectDataSource() private readonly data: DataSource) {}

  create(_: unknown, identity: VerifiedIdentity) {
    this.superAdmin(identity);
    throw new ForbiddenException('permissions are system-defined');
  }

  async permissionsFor(role: string): Promise<readonly string[]> {
    const builtIn = SYSTEM_PERMISSION_MATRIX[role] ?? [];
    if (builtIn.includes('*')) return builtIn;
    try {
      const rows = await this.data.query<Array<{ permission_key: string }>>(
        `SELECT p.permission_key FROM public.role_permissions rp
         JOIN public.permission_definitions p ON p.id=rp.permission_id
         WHERE rp.role::text=$1 AND rp.enabled=true AND p.active=true ORDER BY p.permission_key`,
        [role],
      );
      return rows.map((row) => row.permission_key);
    } catch (error) {
      if (this.missingPermissionSchema(error)) return builtIn;
      throw error;
    }
  }

  async hasPermission(
    identity: VerifiedIdentity,
    permission: string,
  ): Promise<boolean> {
    const granted = await this.permissionsFor(identity.role);
    return granted.includes('*') || granted.includes(permission);
  }

  async require(
    identity: VerifiedIdentity,
    ...permissions: string[]
  ): Promise<void> {
    const granted = await this.permissionsFor(identity.role);
    if (
      permissions.some(
        (permission) => !granted.includes('*') && !granted.includes(permission),
      )
    )
      throw new ForbiddenException('insufficient permission');
  }

  async findAll(identity: VerifiedIdentity) {
    this.admin(identity);
    return Promise.all(
      Object.keys(SYSTEM_PERMISSION_MATRIX).map((role) => this.profile(role)),
    );
  }

  async findOne(id: string, identity: VerifiedIdentity) {
    this.admin(identity);
    if (!SYSTEM_PERMISSION_MATRIX[id])
      throw new NotFoundException('permission profile not found');
    return this.profile(id);
  }

  async update(
    role: string,
    dto: PermissionUpdate,
    identity: VerifiedIdentity,
  ) {
    this.superAdmin(identity);
    if (!SYSTEM_PERMISSION_MATRIX[role] || role === 'super_admin')
      throw new ForbiddenException(
        'protected role permission profile cannot be modified',
      );
    const permissions = this.permissionList(dto.permissions);
    try {
      return await this.data.transaction(async (manager) => {
        const before = await manager.query<Array<{ permission_key: string }>>(
          `SELECT p.permission_key FROM public.role_permissions rp JOIN public.permission_definitions p ON p.id=rp.permission_id
           WHERE rp.role::text=$1 AND rp.enabled=true ORDER BY p.permission_key`,
          [role],
        );
        await manager.query(
          'UPDATE public.role_permissions SET enabled=false,updated_at=now(),updated_by=$2 WHERE role::text=$1',
          [role, identity.actorId],
        );
        if (permissions.length)
          await manager.query(
            `INSERT INTO public.role_permissions(role,permission_id,enabled,updated_by)
           SELECT $1::public.user_role,p.id,true,$3 FROM public.permission_definitions p WHERE p.permission_key=ANY($2::text[])
           ON CONFLICT(role,permission_id) DO UPDATE SET enabled=true,updated_at=now(),updated_by=EXCLUDED.updated_by`,
            [role, permissions, identity.actorId],
          );
        await manager.query(
          `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,changes)
           VALUES($1,$2,'ROLE_PERMISSIONS_CHANGED','role_permission',$2,$3::jsonb)`,
          [
            identity.organizationId,
            identity.actorId,
            JSON.stringify({
              role,
              before: before.map((row) => row.permission_key),
              after: permissions,
            }),
          ],
        );
        return this.profile(role, manager);
      });
    } catch (error) {
      if (this.missingPermissionSchema(error))
        throw new ServiceUnavailableException(
          'permission persistence migration is pending',
        );
      throw error;
    }
  }

  remove(_: string, identity: VerifiedIdentity) {
    this.superAdmin(identity);
    throw new ForbiddenException(
      'system permission profiles cannot be removed',
    );
  }

  async history(role: string, identity: VerifiedIdentity) {
    this.superAdmin(identity);
    if (!SYSTEM_PERMISSION_MATRIX[role])
      throw new NotFoundException('permission profile not found');
    return this.data.query(
      `SELECT id,organization_id,user_id,action,resource_type,changes,created_at FROM public.audit_logs
       WHERE action='ROLE_PERMISSIONS_CHANGED' AND resource_type='role_permission' AND changes->>'role'=$1
       ORDER BY created_at DESC`,
      [role],
    );
  }

  private async profile(role: string, source: QuerySource = this.data) {
    let permissions = SYSTEM_PERMISSION_MATRIX[role] ?? [];
    let persisted = false;
    if (!permissions.includes('*')) {
      try {
        const rows = await source.query<Array<{ permission_key: string }>>(
          `SELECT p.permission_key FROM public.role_permissions rp JOIN public.permission_definitions p ON p.id=rp.permission_id
           WHERE rp.role::text=$1 AND rp.enabled=true AND p.active=true ORDER BY p.permission_key`,
          [role],
        );
        permissions = rows.map((row) => row.permission_key);
        persisted = true;
      } catch (error) {
        if (!this.missingPermissionSchema(error)) throw error;
      }
    }
    return {
      id: role,
      role,
      permissions: [...permissions],
      system: true,
      mutable: role !== 'super_admin',
      persisted,
    };
  }

  private permissionList(value: unknown): PermissionName[] {
    if (
      !Array.isArray(value) ||
      value.some(
        (item) =>
          typeof item !== 'string' ||
          !PERMISSION_DEFINITIONS.includes(item as PermissionName),
      )
    )
      throw new ForbiddenException(
        'permission profile contains an unsupported permission',
      );
    return [...new Set(value as PermissionName[])].sort();
  }

  private missingPermissionSchema(error: unknown): boolean {
    return (
      !!error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === '42P01'
    );
  }
  private admin(identity: VerifiedIdentity) {
    if (!['admin', 'super_admin'].includes(identity.role))
      throw new ForbiddenException('administrator access required');
  }
  private superAdmin(identity: VerifiedIdentity) {
    if (identity.role !== 'super_admin')
      throw new ForbiddenException('super administrator access required');
  }
}
