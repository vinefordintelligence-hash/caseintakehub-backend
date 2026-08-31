import { ConfigService } from '@nestjs/config';
import { ActivityNotificationService } from './activity-notification.service';

describe('ActivityNotificationService', () => {
  const event = {
    eventKey: 'intake.submitted:test',
    eventType: 'intake.submitted',
    category: 'intake',
    organizationId: 'org',
    entityType: 'case_intake',
    entityId: 'intake',
    title: 'New Assessment Submitted',
    description: 'A new client assessment has been submitted.',
  };
  it('uses a unique event key so retries do not duplicate jobs', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'job' }])
      .mockResolvedValueOnce([]);
    const service = new ActivityNotificationService(
      { query } as never,
      { get: jest.fn() } as never,
    );
    await expect(service.enqueue(event)).resolves.toBe(true);
    await expect(service.enqueue(event)).resolves.toBe(false);
    expect(query.mock.calls[0][0]).toContain(
      'ON CONFLICT(event_key) DO NOTHING',
    );
  });

  it('isolates an unavailable email transport and schedules a retry', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("delivery_status='processing'"))
        return [
          {
            id: 'job',
            event_type: 'kyc.submitted',
            category: 'kyc',
            organization_id: 'org',
            entity_type: 'client_kyc',
            entity_id: 'kyc',
            title: 'Kyc Submitted',
            description: 'A meaningful activity was recorded.',
            occurred_at: new Date(),
            attempts: 1,
          },
        ];
      if (sql.includes('activity_notification_settings')) return [];
      if (sql.includes('FROM public.app_users'))
        return [{ email: 'admin@example.test' }];
      return [];
    });
    const service = new ActivityNotificationService(
      { query } as never,
      new ConfigService({ FROM_EMAIL: 'alerts@example.test' }),
    );
    await expect(service.processPending()).resolves.toBeUndefined();
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("delivery_status='failed'"),
      ),
    ).toBe(true);
  });

  it('sends only the safe event envelope and marks delivery sent', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('activity_notification_settings'))
        return [
          {
            enabled: true,
            recipient_email: 'admin@example.test',
            categories: { intake: true },
            delivery_mode: 'immediate',
          },
        ];
      if (sql.includes('FROM public.organizations'))
        return [{ name: 'Vineford' }];
      return [];
    });
    const values: Record<string, string> = {
      FROM_EMAIL: 'alerts@example.test',
      RESEND_API_KEY: 'test-key',
      VINEFORD_PUBLIC_URL: 'https://vinefordintelligence.com',
      NODE_ENV: 'test',
    };
    const service = new ActivityNotificationService(
      { query } as never,
      { get: jest.fn((key: string) => values[key]) } as never,
    );
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'provider-message' }),
    }) as never;
    try {
      await (service as any).deliver({
        id: 'job',
        event_type: event.eventType,
        category: event.category,
        organization_id: 'org',
        entity_type: event.entityType,
        entity_id: event.entityId,
        title: event.title,
        description: event.description,
        occurred_at: new Date(),
        attempts: 1,
        entity_reference: 'INT-TEST',
      });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({ method: 'POST' }),
      );
      const request = JSON.stringify((global.fetch as jest.Mock).mock.calls);
      expect(request).toContain('New Assessment Submitted');
      expect(request).not.toMatch(/password|pin_hash|access_token/i);
      expect(
        query.mock.calls.some(([sql]) =>
          String(sql).includes("delivery_status='sent'"),
        ),
      ).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('restricts settings to administrators', async () => {
    const service = new ActivityNotificationService(
      { query: jest.fn() } as never,
      { get: jest.fn() } as never,
    );
    await expect(
      service.getSettings({
        actorId: 'client',
        organizationId: 'org',
        role: 'client',
        supabaseUserId: '',
      }),
    ).rejects.toThrow('administrator access required');
  });
});
