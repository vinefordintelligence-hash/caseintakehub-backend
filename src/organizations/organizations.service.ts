import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

@Injectable()
export class OrganizationsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}
  private text(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim())
      throw new BadRequestException(`${field} is required`);
    return value.trim();
  }
  private admin(identity: VerifiedIdentity): void {
    if (!['admin', 'super_admin'].includes(identity.role))
      throw new ForbiddenException('administrator access required');
  }
  private superAdmin(identity: VerifiedIdentity): void {
    if (identity.role !== 'super_admin')
      throw new ForbiddenException('super administrator access required');
  }
  async create(dto: CreateOrganizationDto, identity: VerifiedIdentity) {
    this.superAdmin(identity);
    const name = this.text(dto.name, 'name'),
      slug = this.text(dto.slug, 'slug').toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug))
      throw new BadRequestException(
        'slug must contain 2–63 lowercase letters, numbers, or hyphens',
      );
    return this.db.transaction(async (manager) => {
      if (
        (
          await manager.query(
            'SELECT id FROM public.organizations WHERE slug=$1',
            [slug],
          )
        )[0]
      )
        throw new BadRequestException('organization slug is already in use');
      const organization = (
        await manager.query(
          `INSERT INTO public.organizations(name,slug,description) VALUES($1,$2,$3) RETURNING id,name,slug,description,created_at,updated_at`,
          [name, slug, dto.description?.trim() || null],
        )
      )[0];
      const membership = (
        await manager.query(
          `INSERT INTO public.organization_memberships(organization_id,app_user_id,role,status) VALUES($1,$2,'super_admin','active') RETURNING id,organization_id,app_user_id,role,status`,
          [organization.id, identity.actorId],
        )
      )[0];
      await manager.query(
        `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,changes) VALUES($1,$2,'ORGANIZATION_CREATED','organization',$3,$4::jsonb)`,
        [
          organization.id,
          identity.actorId,
          organization.id,
          JSON.stringify({ name, slug, created_by: identity.actorId }),
        ],
      );
      await manager.query(
        `INSERT INTO public.audit_logs(organization_id,user_id,action,resource_type,resource_id,changes) VALUES($1,$2,'ORGANIZATION_MEMBERSHIP_CREATED','organization_membership',$3,$4::jsonb)`,
        [
          organization.id,
          identity.actorId,
          membership.id,
          JSON.stringify({
            organization_id: organization.id,
            app_user_id: identity.actorId,
            role: 'super_admin',
          }),
        ],
      );
      return { organization, membership };
    });
  }
  async findAll(identity: VerifiedIdentity) {
    this.admin(identity);
    return this.db.query(
      `SELECT o.id,o.name,o.slug,o.description,o.created_at,o.updated_at,m.role,m.status FROM public.organizations o JOIN public.organization_memberships m ON m.organization_id=o.id WHERE m.app_user_id=$1 AND m.status='active' ORDER BY o.created_at`,
      [identity.actorId],
    );
  }
  async findOne(id: string, identity: VerifiedIdentity) {
    this.admin(identity);
    const rows = await this.db.query(
      `SELECT o.id,o.name,o.slug,o.description,o.created_at,o.updated_at,m.role,m.status FROM public.organizations o JOIN public.organization_memberships m ON m.organization_id=o.id WHERE o.id=$1 AND m.app_user_id=$2 AND m.status='active'`,
      [id, identity.actorId],
    );
    if (!rows[0]) throw new NotFoundException('organization not found');
    return rows[0];
  }
  async update(
    id: string,
    dto: UpdateOrganizationDto,
    identity: VerifiedIdentity,
  ) {
    this.admin(identity);
    await this.findOne(id, identity);
    const rows = await this.db.query(
      `UPDATE public.organizations SET name=COALESCE($1,name),description=COALESCE($2,description),updated_at=now() WHERE id=$3 RETURNING *`,
      [dto.name ?? null, dto.description ?? null, id],
    );
    return rows[0];
  }
  async remove(id: string, identity: VerifiedIdentity) {
    this.superAdmin(identity);
    if (id === identity.organizationId)
      throw new BadRequestException('current organization cannot be removed');
    await this.findOne(id, identity);
    throw new ForbiddenException(
      'organization removal is disabled for protected data',
    );
  }
}
