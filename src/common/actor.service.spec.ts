import { ActorService } from './actor.service';
import { ForbiddenException } from '@nestjs/common';
describe('ActorService', () => {
  it('requires an active user and active organization membership', async () => {
    const db = {
      query: jest
        .fn()
        .mockResolvedValue([
          { id: 'a', role: 'admin', organization_id: 'org' },
        ]),
    };
    await expect(
      new ActorService(db as never).requireAdmin('a'),
    ).resolves.toMatchObject({ id: 'a' });
    expect(db.query.mock.calls[0][0]).toContain("m.status='active'");
    expect(db.query.mock.calls[0][0]).toContain('u.is_active=true');
  });
  it('denies missing, inactive, client, or unlinked actors', async () => {
    const db = { query: jest.fn().mockResolvedValue([]) };
    await expect(
      new ActorService(db as never).requireAdmin('forged'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
