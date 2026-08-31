import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { VerifiedIdentity } from '../identity/supabase-identity.service';
import { VINEFORD_USER_ROLES } from '../identity/supabase-identity.service';

const ROLES = VINEFORD_USER_ROLES;

type RoleName = (typeof ROLES)[number];

@Injectable()
export class RolesService {
  create(_: unknown, identity: VerifiedIdentity) {
    this.superAdmin(identity);
    throw new ForbiddenException(
      'custom role creation is disabled; Vineford uses protected system roles',
    );
  }

  findAll(identity: VerifiedIdentity) {
    this.admin(identity);

    return ROLES.map((name) => ({
      id: name,
      name,
      system: true,
      mutable: false,
    }));
  }

  findOne(id: string, identity: VerifiedIdentity) {
    this.admin(identity);

    if (!ROLES.includes(id as RoleName)) {
      throw new NotFoundException('role not found');
    }

    return {
      id,
      name: id,
      system: true,
      mutable: false,
    };
  }

  update(_: string, __: unknown, identity: VerifiedIdentity) {
    this.superAdmin(identity);
    throw new ForbiddenException(
      'system roles cannot be modified through this endpoint',
    );
  }

  remove(_: string, identity: VerifiedIdentity) {
    this.superAdmin(identity);
    throw new ForbiddenException(
      'system roles cannot be removed through this endpoint',
    );
  }

  private admin(identity: VerifiedIdentity) {
    if (!['admin', 'super_admin'].includes(identity.role)) {
      throw new ForbiddenException('administrator access required');
    }
  }

  private superAdmin(identity: VerifiedIdentity) {
    if (identity.role !== 'super_admin') {
      throw new ForbiddenException('super administrator access required');
    }
  }
}
