import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';

const superAdmin = {
  actorId: 'admin-a',
  organizationId: 'prod-org',
  role: 'super_admin',
  supabaseUserId: 'sup-a',
} as const;
const admin = { ...superAdmin, role: 'admin' } as const;

describe('OrganizationsService multi-organization provisioning', () => {
  it('creates an organization and active SUPER_ADMIN membership atomically', async () => {
    const manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes('SELECT id FROM public.organizations')
          ? []
          : sql.includes('INSERT INTO public.organizations')
            ? [
                {
                  id: 'sandbox-org',
                  name: 'Vineford TestNet Sandbox',
                  slug: 'vineford-testnet-sandbox',
                },
              ]
            : sql.includes('INSERT INTO public.organization_memberships')
              ? [
                  {
                    id: 'membership-a',
                    organization_id: 'sandbox-org',
                    app_user_id: 'admin-a',
                    role: 'super_admin',
                    status: 'active',
                  },
                ]
              : [],
      ),
    };
    const db = {
      transaction: jest.fn(async (fn: (m: typeof manager) => unknown) =>
        fn(manager),
      ),
    };
    const result = await new OrganizationsService(db as never).create(
      {
        name: 'Vineford TestNet Sandbox',
        slug: 'vineford-testnet-sandbox',
        description: 'TESTNET / SANDBOX',
      },
      superAdmin,
    );
    expect(result.organization.id).toBe('sandbox-org');
    expect(result.membership.role).toBe('super_admin');
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
  it('rejects non-super-admin creation before database mutation', async () => {
    const db = { transaction: jest.fn() };
    await expect(
      new OrganizationsService(db as never).create(
        { name: 'Nope', slug: 'nope' },
        admin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it('rejects duplicate slugs', async () => {
    const manager = {
      query: jest.fn().mockResolvedValue([{ id: 'existing' }]),
    };
    const db = {
      transaction: jest.fn(async (fn: (m: typeof manager) => unknown) =>
        fn(manager),
      ),
    };
    await expect(
      new OrganizationsService(db as never).create(
        { name: 'Duplicate', slug: 'duplicate' },
        superAdmin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
