import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports liveness without dependencies', () => {
    expect(new HealthService({} as never, {} as never).live()).toEqual({
      status: 'ok',
      service: 'vineford-backend',
    });
  });
  it('reports readiness only when the database answers', async () => {
    await expect(
      new HealthService(
        { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as never,
        {} as never,
      ).ready(),
    ).resolves.toEqual({ status: 'ready' });
    await expect(
      new HealthService(
        {
          query: jest.fn().mockRejectedValue(new Error('secret db error')),
        } as never,
        {} as never,
      ).ready(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it('exposes configuration presence but never configuration values', async () => {
    const service = new HealthService(
      { query: jest.fn().mockResolvedValue([]) } as never,
      {
        get: jest.fn((key) =>
          key === 'SUPABASE_URL'
            ? 'secret-url'
            : key === 'SUPABASE_ANON_KEY'
              ? 'secret-key'
              : undefined,
        ),
      } as never,
    );
    const result = await service.dependencies();
    expect(result.supabaseIdentityConfigured).toBe(true);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});
