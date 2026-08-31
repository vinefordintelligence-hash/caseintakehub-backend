import { IntakesService } from './intakes.service';

describe('public intake activity notification', () => {
  it('queues a meaningful notification after persistence without blocking the response', async () => {
    const db = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'org' }])
        .mockResolvedValueOnce([
          {
            id: '12345678-0000-0000-0000-000000000000',
            status: 'submitted',
            submitted_at: new Date(),
          },
        ]),
    };
    const notifications = {
      enqueue: jest.fn().mockRejectedValue(new Error('mail unavailable')),
    };
    const service = new IntakesService(
      db as never,
      {} as never,
      notifications as never,
    );
    await expect(
      service.publicSubmit({
        first_name: 'Test',
        last_name: 'Client',
        email: 'test@example.test',
        country: 'US',
        services: ['Fraud'],
        situation: 'Test matter',
      }),
    ).resolves.toMatchObject({
      status: 'submitted',
      reference: 'INT-12345678',
    });
    expect(notifications.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'intake.submitted',
        category: 'intake',
      }),
    );
  });
});
