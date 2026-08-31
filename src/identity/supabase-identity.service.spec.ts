import { UnauthorizedException } from '@nestjs/common';
import { SupabaseIdentityService } from './supabase-identity.service';

describe('SupabaseIdentityService', () => {
  const config = {
    get: jest.fn((key: string) =>
      key === 'SUPABASE_URL' ? 'https://example.test' : 'anon',
    ),
  };
  afterEach(() => jest.restoreAllMocks());
  const jwt = {
    verifyAsync: jest.fn().mockRejectedValue(new Error('not a client session')),
  };
  it('fails closed for missing, invalid, unknown, spoofed, and cross-tenant identities', async () => {
    const query = jest.fn();
    const service = new SupabaseIdentityService(
      config as never,
      { query } as never,
      jwt as never,
    );
    await expect(service.verify()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(service.verify('Bearer malformed')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ id: 'sub-a' }), { status: 200 }),
      );
    query.mockResolvedValueOnce([]);
    await expect(service.verify('Bearer valid')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    query.mockResolvedValueOnce([
      { actor_id: 'actor-a', organization_id: 'org-a', role: 'admin' },
    ]);
    await expect(
      service.verify('Bearer valid', 'actor-b'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('accepts exactly one active same-organization linked identity', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ id: 'sub-a' }), { status: 200 }),
      );
    const service = new SupabaseIdentityService(
      config as never,
      {
        query: jest
          .fn()
          .mockResolvedValue([
            { actor_id: 'actor-a', organization_id: 'org-a', role: 'admin' },
          ]),
      } as never,
      jwt as never,
    );
    await expect(
      service.verify('Bearer valid', 'actor-a'),
    ).resolves.toMatchObject({ actorId: 'actor-a', organizationId: 'org-a' });
  });
  it('accepts an explicitly selected organization only through an active membership', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'sub-a' }), { status: 200 }),
      );
    const query = jest.fn().mockResolvedValue([
      {
        actor_id: 'actor-a',
        organization_id: 'sandbox-org',
        role: 'super_admin',
      },
    ]);
    const service = new SupabaseIdentityService(
      config as never,
      { query } as never,
      jwt as never,
    );
    await expect(
      service.verify('Bearer valid', 'actor-a', 'sandbox-org'),
    ).resolves.toMatchObject({
      organizationId: 'sandbox-org',
      role: 'super_admin',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('m.organization_id = $2::uuid'),
      ['sub-a', 'sandbox-org'],
    );
  });
});
