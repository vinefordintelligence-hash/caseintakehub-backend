import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserListQueryDto } from './dto/user-list-query.dto';
import {
  VerifiedIdentity,
  VinefordUserRole,
} from '../identity/supabase-identity.service';

type UserRow = Record<string, unknown> & {
  id: string;
  role: string;
  is_active: boolean;
};

@Injectable()
export class UsersService {
  constructor(@InjectDataSource() private readonly data: DataSource) {}

  async create(dto: CreateUserDto, identity: VerifiedIdentity) {
    this.admin(identity);
    this.assertAssignableRole(dto.role, identity);
    const name = dto.name.trim();
    const email = dto.email.trim().toLowerCase();
    return this.data.transaction(async (manager) => {
      const duplicate = await manager.query(
        'SELECT id FROM public.app_users WHERE lower(email)=lower($1)',
        [email],
      );
      if (duplicate[0])
        throw new ConflictException('user email is already registered');
      const rows = await manager.query<UserRow[]>(
        `INSERT INTO public.app_users(id,organization_id,name,email,role,is_active)
         VALUES(public.uuid_generate_v4(),$1,$2,$3,$4::public.user_role,true)
         RETURNING id,organization_id,name,email,role::text,is_active,created_at,updated_at`,
        [identity.organizationId, name, email, dto.role],
      );
      const user = rows[0];
      await manager.query(
        `INSERT INTO public.organization_memberships(organization_id,app_user_id,role,status)
         VALUES($1,$2,$3,'active')
         ON CONFLICT(organization_id,app_user_id) DO UPDATE SET role=EXCLUDED.role,status='active',updated_at=now()`,
        [identity.organizationId, user.id, dto.role],
      );
      await this.audit(manager, identity, 'USER_CREATED', user.id, {
        role: dto.role,
        identity_linked: false,
      });
      return { ...user, identity_linked: false, membership_status: 'active' };
    });
  }

  async findAll(
    identity: VerifiedIdentity,
    query: UserListQueryDto = new UserListQueryDto(),
  ) {
    this.staff(identity);
    const params: unknown[] = [identity.organizationId];
    const clauses = [
      'u.organization_id=$1',
      "m.status IN ('active','inactive')",
    ];
    if (query.role) {
      params.push(query.role);
      clauses.push(`m.role=$${params.length}`);
    }
    if (query.status) {
      params.push(query.status);
      clauses.push(`m.status=$${params.length}`);
    }
    if (query.search?.trim()) {
      params.push(`%${query.search.trim().replace(/[\\%_]/g, '\\$&')}%`);
      clauses.push(
        `(u.name ILIKE $${params.length} ESCAPE '\\' OR u.email ILIKE $${params.length} ESCAPE '\\')`,
      );
    }
    params.push(query.limit ?? 50, query.offset ?? 0);
    const items = await this.data.query(
      `SELECT u.id,u.organization_id,u.name,u.email,u.role::text,u.is_active,u.last_sign_in_at,u.created_at,u.updated_at,
              m.id membership_id,m.role membership_role,m.status membership_status,
              EXISTS(SELECT 1 FROM public.vf_identity_links l WHERE l.app_user_id=u.id AND l.organization_id=u.organization_id AND l.status='active') identity_linked,
              (SELECT count(*)::int FROM public.case_assignments a WHERE a.app_user_id=u.id AND a.organization_id=u.organization_id AND a.active=true) active_case_assignments
       FROM public.app_users u JOIN public.organization_memberships m ON m.app_user_id=u.id AND m.organization_id=u.organization_id
       WHERE ${clauses.join(' AND ')} ORDER BY u.name NULLS LAST,u.email LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items, limit: query.limit ?? 50, offset: query.offset ?? 0 };
  }

  async findOne(id: string, identity: VerifiedIdentity) {
    this.staff(identity);
    if (!this.isAdmin(identity) && id !== identity.actorId)
      throw new NotFoundException('user not found');
    const rows = await this.data.query<UserRow[]>(
      `SELECT u.id,u.organization_id,u.name,u.email,u.role::text,u.is_active,u.last_sign_in_at,u.created_at,u.updated_at,
              m.id membership_id,m.role membership_role,m.status membership_status,
              EXISTS(SELECT 1 FROM public.vf_identity_links l WHERE l.app_user_id=u.id AND l.organization_id=u.organization_id AND l.status='active') identity_linked,
              (SELECT count(*)::int FROM public.case_assignments a WHERE a.app_user_id=u.id AND a.organization_id=u.organization_id AND a.active=true) active_case_assignments
       FROM public.app_users u JOIN public.organization_memberships m ON m.app_user_id=u.id AND m.organization_id=u.organization_id
       WHERE u.id=$1 AND u.organization_id=$2`,
      [id, identity.organizationId],
    );
    if (!rows[0]) throw new NotFoundException('user not found');
    return rows[0];
  }

  async activity(id: string, identity: VerifiedIdentity) {
    await this.findOne(id, identity);
    const [events, assignments] = await Promise.all([
      this.data.query(
        `SELECT id,action,resource_type,resource_id,case_id,changes,created_at FROM public.audit_logs
         WHERE user_id=$1 AND organization_id=$2 ORDER BY created_at DESC LIMIT 100`,
        [id, identity.organizationId],
      ),
      this.data.query(
        `SELECT a.id,a.case_id,c.case_number,a.assignment_role,a.active,a.assigned_at,a.unassigned_at
         FROM public.case_assignments a JOIN public.cases c ON c.id=a.case_id AND c.organization_id=a.organization_id
         WHERE a.app_user_id=$1 AND a.organization_id=$2 ORDER BY a.assigned_at DESC LIMIT 100`,
        [id, identity.organizationId],
      ),
    ]);
    return { user_id: id, events, assignments };
  }

  async update(id: string, dto: UpdateUserDto, identity: VerifiedIdentity) {
    this.admin(identity);
    if (!dto.name && dto.role === undefined && dto.is_active === undefined)
      throw new BadRequestException('no user fields supplied');
    if (
      id === identity.actorId &&
      (dto.role !== undefined || dto.is_active === false)
    )
      throw new ForbiddenException(
        'cannot change the current user role or deactivate the current user',
      );
    if (dto.role) this.assertAssignableRole(dto.role, identity);
    return this.data.transaction(async (manager) => {
      const before = await this.lockedUser(
        manager,
        id,
        identity.organizationId,
      );
      if (!this.canManageRole(before.role as VinefordUserRole, identity))
        throw new ForbiddenException('cannot manage this user role');
      const nextRole = dto.role ?? before.role;
      const nextActive = dto.is_active ?? before.is_active;
      if (
        before.role === 'super_admin' &&
        (nextRole !== 'super_admin' || !nextActive)
      ) {
        const remaining = await manager.query<Array<{ count: number }>>(
          `SELECT count(*)::int count FROM public.app_users u
           JOIN public.organization_memberships m ON m.app_user_id=u.id AND m.organization_id=u.organization_id
           WHERE u.organization_id=$1 AND u.id<>$2 AND u.role='super_admin' AND u.is_active=true AND m.status='active'`,
          [identity.organizationId, id],
        );
        if (!remaining[0]?.count)
          throw new ConflictException(
            'cannot remove the last active super administrator',
          );
      }
      const rows = await manager.query<UserRow[]>(
        `UPDATE public.app_users SET name=COALESCE($1,name),role=$2::public.user_role,is_active=$3,updated_at=now()
         WHERE id=$4 AND organization_id=$5 RETURNING id,organization_id,name,email,role::text,is_active,created_at,updated_at`,
        [
          dto.name?.trim() || null,
          nextRole,
          nextActive,
          id,
          identity.organizationId,
        ],
      );
      await manager.query(
        `UPDATE public.organization_memberships SET role=$1,status=$2,updated_at=now()
         WHERE app_user_id=$3 AND organization_id=$4`,
        [
          nextRole,
          nextActive ? 'active' : 'inactive',
          id,
          identity.organizationId,
        ],
      );
      await manager.query(
        `UPDATE public.vf_identity_links SET status=$1,updated_at=now()
         WHERE app_user_id=$2 AND organization_id=$3`,
        [nextActive ? 'active' : 'inactive', id, identity.organizationId],
      );
      if (!nextActive)
        await manager.query(
          `UPDATE public.case_assignments SET active=false,unassigned_at=COALESCE(unassigned_at,now()),updated_at=now()
         WHERE app_user_id=$1 AND organization_id=$2 AND active=true`,
          [id, identity.organizationId],
        );
      const action =
        before.is_active && !nextActive
          ? 'USER_DEACTIVATED'
          : !before.is_active && nextActive
            ? 'USER_ACTIVATED'
            : before.role !== nextRole
              ? 'USER_ROLE_CHANGED'
              : 'USER_PROFILE_UPDATED';
      await this.audit(manager, identity, action, id, {
        before: {
          name: before.name,
          role: before.role,
          is_active: before.is_active,
        },
        after: {
          name: rows[0].name,
          role: rows[0].role,
          is_active: rows[0].is_active,
        },
      });
      return rows[0];
    });
  }

  async remove(id: string, identity: VerifiedIdentity) {
    this.admin(identity);
    if (id === identity.actorId)
      throw new ForbiddenException('cannot deactivate the current user');
    return this.update(id, { is_active: false }, identity);
  }

  private async lockedUser(
    manager: EntityManager,
    id: string,
    organizationId: string,
  ): Promise<UserRow> {
    const rows = await manager.query<UserRow[]>(
      'SELECT id,name,role::text,is_active FROM public.app_users WHERE id=$1 AND organization_id=$2 FOR UPDATE',
      [id, organizationId],
    );
    if (!rows[0]) throw new NotFoundException('user not found');
    return rows[0];
  }

  private async audit(
    manager: EntityManager,
    identity: VerifiedIdentity,
    action: string,
    userId: string,
    changes: Record<string, unknown>,
  ) {
    await manager.query(
      `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,changes)
       VALUES($1,$2,$3,'user',$4,$5::jsonb)`,
      [
        identity.organizationId,
        identity.actorId,
        action,
        userId,
        JSON.stringify(changes),
      ],
    );
  }

  private assertAssignableRole(
    role: VinefordUserRole,
    identity: VerifiedIdentity,
  ) {
    if (role === 'client')
      throw new ForbiddenException(
        'client accounts are managed through case access',
      );
    if (!this.canManageRole(role, identity))
      throw new ForbiddenException('cannot assign this user role');
  }
  private canManageRole(role: VinefordUserRole, identity: VerifiedIdentity) {
    return (
      identity.role === 'super_admin' ||
      !['admin', 'super_admin'].includes(role)
    );
  }
  private isAdmin(identity: VerifiedIdentity) {
    return ['admin', 'super_admin'].includes(identity.role);
  }
  private staff(identity: VerifiedIdentity) {
    if (identity.role === 'client')
      throw new ForbiddenException('staff access required');
  }
  private admin(identity: VerifiedIdentity) {
    if (!this.isAdmin(identity))
      throw new ForbiddenException('administrator access required');
  }
}
