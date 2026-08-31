import { CaseReferenceService } from './case-reference.service';

describe('CaseReferenceService', () => {
  it('creates only VF-year-four-digit references', async () => {
    const service = new CaseReferenceService();
    const reference = await service.create(async (value) => value);
    expect(reference).toMatch(/^VF-\d{4}-\d{4}$/);
    expect(reference.split('-')[2]).toMatch(/^\d{4}$/);
  });

  it('retries a unique collision without mutating the collided reference', async () => {
    const service = new CaseReferenceService();
    const generated = jest
      .spyOn(service as never, 'reference' as never)
      .mockReturnValueOnce('VF-2026-1227' as never)
      .mockReturnValueOnce('VF-2026-4821' as never);
    const existing = ['VF-2026-1227'];
    const inserted: string[] = [];
    const result = await service.create(async (reference) => {
      inserted.push(reference);
      if (existing.includes(reference))
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      return reference;
    });
    expect(result).toBe('VF-2026-4821');
    expect(inserted).toEqual(['VF-2026-1227', 'VF-2026-4821']);
    expect(existing).toEqual(['VF-2026-1227']);
    expect(generated).toHaveBeenCalledTimes(2);
  });

  it('does not retry unrelated insert failures', async () => {
    const service = new CaseReferenceService();
    const insert = jest
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('invalid client'), { code: '23503' }),
      );
    await expect(service.create(insert)).rejects.toThrow('invalid client');
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
