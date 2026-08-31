import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { KycService } from './kyc.service';

const admin = {
  actorId: 'admin-a',
  organizationId: 'org-a',
  role: 'admin',
  supabaseUserId: 'sup-a',
} as any;
const client = {
  actorId: 'client-a',
  organizationId: 'org-a',
  role: 'client',
  supabaseUserId: '',
  caseId: 'case-a',
} as any;
const otherClient = { ...client, actorId: 'client-b', caseId: 'case-b' };

describe('KycService authorization and verification integrity', () => {
  const config = {
    get: jest.fn().mockReturnValue('/tmp/vineford-kyc-test-do-not-write'),
  };
  it('returns NOT_STARTED without creating a production record', async () => {
    const db = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ client_id: 'c-a', case_id: 'case-a' }])
        .mockResolvedValueOnce([]),
    };
    await expect(
      new KycService(db as never, config as never).mine(client),
    ).resolves.toMatchObject({ status: 'not_started' });
    expect(
      db.query.mock.calls.some((c) => String(c[0]).includes('INSERT')),
    ).toBe(false);
  });
  it('does not allow a client to use the reviewer queue', async () => {
    await expect(
      new KycService({} as never, config as never).list(client),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('does not allow a client to self-verify', async () => {
    await expect(
      new KycService({} as never, config as never).review(
        '00000000-0000-0000-0000-000000000001',
        { status: 'verified' },
        client,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('scopes client KYC lookup to verified organization, case, and client identity', async () => {
    const db = {
      query: jest
        .fn()
        .mockResolvedValueOnce([{ client_id: 'c-b', case_id: 'case-b' }])
        .mockResolvedValueOnce([]),
    };
    await expect(
      new KycService(db as never, config as never).mine(otherClient),
    ).resolves.toMatchObject({ status: 'not_started' });
    expect(db.query.mock.calls[0][1]).toEqual(['case-b', 'org-a']);
    expect(db.query.mock.calls[1][1]).toEqual(['org-a', 'c-b']);
  });
  it('rejects verification until every mandatory document is verified', async () => {
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([
          { id: 'kyc-a', organization_id: 'org-a', status: 'under_review' },
        ])
        .mockResolvedValueOnce([
          {
            required: true,
            status: 'rejected',
            document_status: 'rejected',
            current_document_id: 'doc-a',
          },
        ]),
    };
    const db = { transaction: jest.fn(async (fn: any) => fn(manager)) };
    await expect(
      new KycService(db as never, config as never).review(
        'kyc-a',
        { status: 'verified' },
        admin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('allows an authorized reviewer to verify only a complete record and audits it', async () => {
    const sql: string[] = [];
    const manager = {
      query: jest.fn(async (q: string) => {
        sql.push(q);
        if (q.includes('FOR UPDATE'))
          return [
            { id: 'kyc-a', organization_id: 'org-a', status: 'under_review' },
          ];
        if (q.includes('LEFT JOIN public.kyc_documents'))
          return [
            {
              required: true,
              status: 'verified',
              document_status: 'verified',
              current_document_id: 'doc-a',
            },
          ];
        if (q.includes('UPDATE public.client_kyc'))
          return [{ id: 'kyc-a', status: 'verified' }];
        return [];
      }),
    };
    const db = { transaction: jest.fn(async (fn: any) => fn(manager)) };
    await expect(
      new KycService(db as never, config as never).review(
        'kyc-a',
        { status: 'verified' },
        admin,
      ),
    ).resolves.toMatchObject({ status: 'verified' });
    expect(
      sql.some((q) => q.includes('INSERT INTO public.kyc_status_history')),
    ).toBe(true);
    expect(sql.some((q) => q.includes('INSERT INTO public.audit_logs'))).toBe(
      true,
    );
  });
  it('requires client-facing instructions when more information is requested', async () => {
    await expect(
      new KycService({} as never, config as never).review(
        'kyc-a',
        { status: 'more_information_required' },
        admin,
      ),
    ).rejects.toThrow('client-facing reason is required');
  });
  it('turns a rejected KYC document into an auditable resubmission state', async () => {
    const sql: string[] = [];
    const manager = {
      query: jest.fn(async (q: string) => {
        sql.push(q);
        if (q.includes('FROM public.kyc_documents'))
          return [
            {
              id: 'doc-a',
              status: 'submitted',
              requirement_id: 'req-a',
              kyc_id: 'kyc-a',
              kyc_status: 'under_review',
            },
          ];
        return [];
      }),
    };
    const db = { transaction: jest.fn(async (fn: any) => fn(manager)) };
    await expect(
      new KycService(db as never, config as never).reviewDocument(
        'doc-a',
        {
          status: 'rejected',
          client_action_reason: 'Upload an unexpired image.',
        },
        admin,
      ),
    ).resolves.toMatchObject({ status: 'rejected' });
    expect(sql.some((q) => q.includes("'more_information_required'"))).toBe(
      true,
    );
    expect(
      sql.some((q) => q.includes('INSERT INTO public.kyc_status_history')),
    ).toBe(true);
  });
  it('denies cross-organization detail access when no scoped record exists', async () => {
    const db = { query: jest.fn().mockResolvedValue([]) };
    await expect(
      new KycService(db as never, config as never).detail('kyc-other', admin),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.query.mock.calls[0][1]).toEqual(['kyc-other', 'org-a']);
  });
});
