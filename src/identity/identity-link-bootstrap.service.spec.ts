import { IdentityLinkBootstrapService } from './identity-link-bootstrap.service';

describe('IdentityLinkBootstrapService', () => {
  const profile = {
    id: 'sub-a',
    email: 'a@example.test',
  };
  it('is dry-run, deterministic, and idempotent for an unambiguous active user', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'actor-a', role: 'admin', organization_id: 'local-org' },
      ]);
    const transaction = jest.fn();
    const service = new IdentityLinkBootstrapService({
      query,
      transaction,
    } as never);
    await expect(service.run([profile], true)).resolves.toMatchObject({
      linked: 1,
      dryRun: true,
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('rejects collisions and ambiguous or inactive candidates without writes', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { app_user_id: 'other', supabase_user_id: 'other-sub' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'a', role: 'admin' },
        { id: 'b', role: 'admin' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const service = new IdentityLinkBootstrapService({
      query,
      transaction: jest.fn(),
    } as never);
    const result = await service.run(
      [
        profile,
        { ...profile, id: 'sub-b' },
        { ...profile, id: 'sub-c', email: 'inactive@example.test' },
      ],
      false,
    );
    expect(result).toMatchObject({
      conflicts: 1,
      skippedAmbiguous: 1,
      skippedInactive: 1,
      linked: 0,
    });
    expect(
      query.mock.calls.some((call) =>
        String(call[0]).startsWith('INSERT INTO public.vf_identity_links'),
      ),
    ).toBe(false);
  });

  it('uses the unique local organization and role as authority in one transaction', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'actor-a', role: 'admin', organization_id: 'local-org' },
      ]);
    const managerQuery = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ status: 'active' }])
      .mockResolvedValueOnce([]);
    const transaction = jest.fn(
      async (
        work: (manager: { query: typeof managerQuery }) => Promise<void>,
      ) => work({ query: managerQuery }),
    );
    const service = new IdentityLinkBootstrapService({
      query,
      transaction,
    } as never);
    await expect(
      service.run(
        [{ ...profile, organization_id: 'hosted-org', role: 'super_admin' }],
        false,
      ),
    ).resolves.toMatchObject({ linked: 1 });
    expect(managerQuery.mock.calls[0][1]).toEqual([
      'local-org',
      'actor-a',
      'admin',
    ]);
    expect(managerQuery.mock.calls[2][1]).toEqual([
      'actor-a',
      'local-org',
      'sub-a',
      'a@example.test',
    ]);
  });
});
