import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface Actor {
  id: string;
  role: string | null;
  organization_id: string | null;
  name: string | null;
  email: string | null;
}

export const ADMIN_ROLES = ['admin', 'super_admin'];

export type AdminActor = Actor & {
  role: 'admin' | 'super_admin';
  organization_id: string;
};

@Injectable()
export class ActorService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async find(id?: string): Promise<Actor | null> {
    if (!id) {
      return null;
    }
    const rows = await this.dataSource.query<Actor[]>(
      `SELECT u.id, u.role, u.organization_id, u.name, u.email
         FROM public.app_users u
         JOIN public.organization_memberships m ON m.app_user_id=u.id AND m.organization_id=u.organization_id AND m.status='active'
        WHERE u.id = $1 AND u.is_active=true`,
      [id],
    );
    return rows[0] ?? null;
  }

  async requireAdmin(id?: string): Promise<AdminActor> {
    const actor = await this.find(id);
    if (
      !actor ||
      !ADMIN_ROLES.includes(actor.role ?? '') ||
      !actor.organization_id
    ) {
      throw new ForbiddenException(
        'permission denied: administrator access required',
      );
    }
    return actor as AdminActor;
  }
}
