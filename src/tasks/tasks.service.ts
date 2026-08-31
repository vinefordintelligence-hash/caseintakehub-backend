import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

@Injectable()
export class TasksService {
  constructor(@InjectDataSource() private readonly data: DataSource) {}
  private client(i: VerifiedIdentity) {
    return i.role === 'client';
  }

  async create(dto: CreateTaskDto, identity: VerifiedIdentity) {
    if (this.client(identity))
      throw new ForbiddenException('client cannot create tasks');
    return this.data.transaction(async (manager) => {
      const cases = await manager.query(
        'SELECT id FROM public.cases WHERE id=$1 AND organization_id=$2',
        [dto.case_id, identity.organizationId],
      );
      if (!cases[0]) throw new NotFoundException('case not found');
      if (dto.assigned_to) {
        const users = await manager.query(
          `SELECT id FROM public.app_users WHERE id=$1 AND organization_id=$2 AND is_active=true AND role<>'client'`,
          [dto.assigned_to, identity.organizationId],
        );
        if (!users[0]) throw new NotFoundException('assignee not found');
      }
      const rows = await manager.query(
        `INSERT INTO public.case_tasks(organization_id,case_id,title,description,priority,assigned_to,client_visible,due_at,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9) RETURNING *`,
        [
          identity.organizationId,
          dto.case_id,
          dto.title.trim(),
          dto.description?.trim() || null,
          dto.priority ?? 'normal',
          dto.assigned_to ?? null,
          dto.client_visible ?? false,
          dto.due_at ?? null,
          identity.actorId,
        ],
      );
      for (const dependency of new Set(dto.depends_on ?? [])) {
        const valid = await manager.query(
          'SELECT id FROM public.case_tasks WHERE id=$1 AND case_id=$2 AND organization_id=$3',
          [dependency, dto.case_id, identity.organizationId],
        );
        if (!valid[0])
          throw new BadRequestException('task dependency is outside this case');
        await manager.query(
          'INSERT INTO public.case_task_dependencies(organization_id,case_id,task_id,depends_on_task_id) VALUES($1,$2,$3,$4)',
          [identity.organizationId, dto.case_id, rows[0].id, dependency],
        );
      }
      await this.history(manager, rows[0], identity, 'created', null, rows[0]);
      return rows[0];
    });
  }

  findAll(identity: VerifiedIdentity) {
    return this.data.query(
      `SELECT t.*,c.case_number,u.name assigned_to_name,
      EXISTS(SELECT 1 FROM public.case_task_dependencies d JOIN public.case_tasks p ON p.id=d.depends_on_task_id WHERE d.task_id=t.id AND p.status NOT IN ('completed','cancelled')) blocked
      FROM public.case_tasks t JOIN public.cases c ON c.id=t.case_id AND c.organization_id=t.organization_id
      LEFT JOIN public.app_users u ON u.id=t.assigned_to AND u.organization_id=t.organization_id
      WHERE t.organization_id=$1 ${this.client(identity) ? 'AND t.case_id=$2 AND t.client_visible=true' : ''}
      ORDER BY t.due_at ASC NULLS LAST,t.created_at DESC`,
      this.client(identity)
        ? [identity.organizationId, identity.caseId]
        : [identity.organizationId],
    );
  }

  async findOne(id: string, identity: VerifiedIdentity) {
    const rows = await this.data.query(
      `SELECT * FROM public.case_tasks WHERE id=$1 AND organization_id=$2 ${this.client(identity) ? 'AND case_id=$3 AND client_visible=true' : ''}`,
      this.client(identity)
        ? [id, identity.organizationId, identity.caseId]
        : [id, identity.organizationId],
    );
    if (!rows[0]) throw new NotFoundException('task not found');
    return rows[0];
  }

  async update(
    id: string,
    dto: UpdateTaskDto & { status?: string },
    identity: VerifiedIdentity,
  ) {
    return this.data.transaction(async (manager) => {
      const before = (
        await manager.query(
          `SELECT * FROM public.case_tasks WHERE id=$1 AND organization_id=$2 ${this.client(identity) ? 'AND case_id=$3 AND client_visible=true' : ''} FOR UPDATE`,
          this.client(identity)
            ? [id, identity.organizationId, identity.caseId]
            : [id, identity.organizationId],
        )
      )[0];
      if (!before) throw new NotFoundException('task not found');
      if (
        this.client(identity) &&
        (!dto.status ||
          !['in_progress', 'completed'].includes(dto.status) ||
          Object.keys(dto).some((key) => key !== 'status'))
      )
        throw new ForbiddenException('client may only progress visible tasks');
      if (dto.status === 'completed') {
        const blocked = await manager.query(
          `SELECT 1 FROM public.case_task_dependencies d JOIN public.case_tasks p ON p.id=d.depends_on_task_id WHERE d.task_id=$1 AND p.status NOT IN ('completed','cancelled') LIMIT 1`,
          [id],
        );
        if (blocked[0])
          throw new BadRequestException('task dependencies are incomplete');
      }
      const allowedStatus = [
        'pending',
        'in_progress',
        'waiting_on_client',
        'completed',
        'cancelled',
      ].includes(String(dto.status))
        ? dto.status
        : null;
      const rows = await manager.query(
        `UPDATE public.case_tasks SET title=COALESCE($1,title),description=CASE WHEN $2 THEN $3 ELSE description END,priority=COALESCE($4,priority),assigned_to=COALESCE($5,assigned_to),client_visible=COALESCE($6,client_visible),due_at=CASE WHEN $7 THEN $8::timestamptz ELSE due_at END,status=COALESCE($9,status),completed_at=CASE WHEN $9='completed' THEN now() ELSE completed_at END,cancelled_at=CASE WHEN $9='cancelled' THEN now() ELSE cancelled_at END,updated_at=now() WHERE id=$10 AND organization_id=$11 RETURNING *`,
        [
          this.client(identity) ? null : (dto.title ?? null),
          !this.client(identity) && dto.description !== undefined,
          dto.description?.trim() || null,
          this.client(identity) ? null : (dto.priority ?? null),
          this.client(identity) ? null : (dto.assigned_to ?? null),
          this.client(identity)
            ? null
            : typeof dto.client_visible === 'boolean'
              ? dto.client_visible
              : null,
          !this.client(identity) && dto.due_at !== undefined,
          dto.due_at ?? null,
          allowedStatus,
          id,
          identity.organizationId,
        ],
      );
      await this.history(
        manager,
        rows[0],
        identity,
        'updated',
        before,
        rows[0],
      );
      return rows[0];
    });
  }

  remove(id: string, identity: VerifiedIdentity) {
    if (this.client(identity))
      throw new ForbiddenException('client cannot cancel tasks');
    return this.update(id, { status: 'cancelled' }, identity);
  }

  private async history(
    manager: { query: (sql: string, params?: unknown[]) => Promise<any[]> },
    task: any,
    identity: VerifiedIdentity,
    action: string,
    before: unknown,
    after: unknown,
  ) {
    await manager.query(
      `INSERT INTO public.case_task_history(task_id,organization_id,case_id,actor_id,action,before_value,after_value) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        task.id,
        identity.organizationId,
        task.case_id,
        identity.actorId,
        action,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
      ],
    );
    await manager.query(
      `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,case_id,changes) VALUES($1,$2,$3,'case_task',$4,$5,$6)`,
      [
        identity.organizationId,
        identity.actorId,
        `TASK_${action.toUpperCase()}`,
        task.id,
        task.case_id,
        JSON.stringify({ before, after }),
      ],
    );
  }
}
