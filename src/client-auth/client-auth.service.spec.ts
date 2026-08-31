import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import {
  ClientAuthService,
  CLIENT_AUTH_GENERIC_ERROR,
} from './client-auth.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

const CASE_A = {
  case_id: '7b2abe2a-9312-42b8-a48d-408fd1771b77',
  case_number: 'VF-2026-8282',
  case_status: 'open',
  organization_id: 'a66e5f92-5c3c-42d5-b270-fba206ef5c0b',
  client_id: '196b680d-e592-4d8a-a527-041931860f9a',
  client_name: 'Gayl M. Chenoweth',
  client_email: 'gayl302726@yahoo.com',
  access_id: 'c0000000-0000-4000-8000-000000000001',
  access_enabled: true,
  pin_hash: null as string | null,
  pin_attempts: 0,
  pin_locked_until: null as string | null,
};

const CASE_B = {
  ...CASE_A,
  case_id: '99999999-9999-4999-8999-999999999999',
  case_number: 'VF-2026-0002',
  client_id: '88888888-8888-4888-8888-888888888888',
  client_name: 'Another Client',
  client_email: 'another@example.com',
};

describe('ClientAuthService', () => {
  let service: ClientAuthService;
  let mockDataSource: { query: jest.Mock };
  let validPin: string;
  let validPinHash: string;
  const auditLogsService = { create: jest.fn() };

  beforeAll(async () => {
    validPin = '482913';
    validPinHash = await bcrypt.hash(validPin, 4);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDataSource = { query: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientAuthService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn().mockResolvedValue('client-token') },
        },
        { provide: AuditLogsService, useValue: auditLogsService },
      ],
    }).compile();

    service = module.get<ClientAuthService>(ClientAuthService);
  });

  function rowWithPin(overrides: Partial<typeof CASE_A> = {}) {
    return [{ ...CASE_A, pin_hash: validPinHash, ...overrides }];
  }

  it('1. valid reference + email + PIN authenticates the client and binds the session to the case', async () => {
    mockDataSource.query
      .mockResolvedValueOnce(rowWithPin())
      .mockResolvedValueOnce([]) // reset attempts (success)
      .mockResolvedValueOnce([{ id: 'a0000000-0000-4000-8000-000000000002' }]); // actor lookup

    const session = await service.login({
      referenceId: 'vf-2026-8282 ',
      email: 'Gayl302726@Yahoo.com',
      pin: validPin,
    });

    expect(session).toEqual({
      sub: 'a0000000-0000-4000-8000-000000000002',
      role: 'client',
      name: 'Gayl M. Chenoweth',
      email: 'gayl302726@yahoo.com',
      organization_id: CASE_A.organization_id,
      client_id: CASE_A.client_id,
      case_id: CASE_A.case_id,
      case_number: CASE_A.case_number,
      access_token: 'client-token',
    });
    expect(session.role).toBe('client');
  });

  it('2. wrong PIN is rejected with the generic message and the failed attempt is recorded', async () => {
    mockDataSource.query
      .mockResolvedValueOnce(rowWithPin())
      .mockResolvedValueOnce([]); // increment attempts

    await expect(
      service.login({
        referenceId: CASE_A.case_number,
        email: CASE_A.client_email,
        pin: '000000',
      }),
    ).rejects.toThrow(CLIENT_AUTH_GENERIC_ERROR);

    expect(mockDataSource.query).toHaveBeenCalledTimes(2);
    const sql = (mockDataSource.query.mock.calls as Array<Array<string>>)[1][0];
    expect(sql).toContain('pin_attempts = pin_attempts + 1');
  });

  it('3. wrong email is rejected with the generic message', async () => {
    mockDataSource.query.mockResolvedValueOnce(rowWithPin());

    await expect(
      service.login({
        referenceId: CASE_A.case_number,
        email: 'someone.else@example.com',
        pin: validPin,
      }),
    ).rejects.toThrow(CLIENT_AUTH_GENERIC_ERROR);

    expect(mockDataSource.query).toHaveBeenCalledTimes(1);
  });

  it('4. wrong reference ID is rejected with the generic message', async () => {
    mockDataSource.query.mockResolvedValueOnce([]);

    await expect(
      service.login({
        referenceId: 'VF-9999-9999',
        email: CASE_A.client_email,
        pin: validPin,
      }),
    ).rejects.toThrow(CLIENT_AUTH_GENERIC_ERROR);

    expect(mockDataSource.query).toHaveBeenCalledTimes(1);
  });

  it('4b. a malformed (non-6-digit) PIN is rejected before any database work', async () => {
    await expect(
      service.login({
        referenceId: CASE_A.case_number,
        email: CASE_A.client_email,
        pin: '12345',
      }),
    ).rejects.toThrow(CLIENT_AUTH_GENERIC_ERROR);

    expect(mockDataSource.query).not.toHaveBeenCalled();
  });

  it('5. valid credentials for Case A cannot authenticate against another client case B', async () => {
    mockDataSource.query.mockResolvedValueOnce(rowWithPin(CASE_B));

    await expect(
      service.login({
        referenceId: CASE_B.case_number,
        email: CASE_A.client_email,
        pin: validPin,
      }),
    ).rejects.toThrow(CLIENT_AUTH_GENERIC_ERROR);

    expect(mockDataSource.query).toHaveBeenCalledTimes(1);
  });

  it('6a. a disabled client access record is rejected', async () => {
    mockDataSource.query.mockResolvedValueOnce(
      rowWithPin({ access_enabled: false }),
    );

    await expect(
      service.login({
        referenceId: CASE_A.case_number,
        email: CASE_A.client_email,
        pin: validPin,
      }),
    ).rejects.toThrow(CLIENT_AUTH_GENERIC_ERROR);
  });

  it('6b. a locked access record is rejected even with the correct PIN', async () => {
    mockDataSource.query.mockResolvedValueOnce(
      rowWithPin({
        pin_locked_until: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
    );

    await expect(
      service.login({
        referenceId: CASE_A.case_number,
        email: CASE_A.client_email,
        pin: validPin,
      }),
    ).rejects.toThrow(CLIENT_AUTH_GENERIC_ERROR);
  });

  it('6c. a non-open (inactive) case is rejected', async () => {
    mockDataSource.query.mockResolvedValueOnce(
      rowWithPin({ case_status: 'on_hold' }),
    );

    await expect(
      service.login({
        referenceId: CASE_A.case_number,
        email: CASE_A.client_email,
        pin: validPin,
      }),
    ).rejects.toThrow(CLIENT_AUTH_GENERIC_ERROR);
  });

  it('7. client login can never mint an administrator session', async () => {
    mockDataSource.query
      .mockResolvedValueOnce(rowWithPin())
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'a0000000-0000-4000-8000-000000000002' }]);

    const session = await service.login({
      referenceId: CASE_A.case_number,
      email: CASE_A.client_email,
      pin: validPin,
    });

    expect(session.role).toBe('client');
    expect(session).not.toHaveProperty('role', 'admin');
    expect(session).not.toHaveProperty('role', 'super_admin');
  });

  it('8. client login grants no withdrawal, handoff or admin capability (no token in the session)', async () => {
    mockDataSource.query
      .mockResolvedValueOnce(rowWithPin())
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'a0000000-0000-4000-8000-000000000002' }]);

    const session = await service.login({
      referenceId: CASE_A.case_number,
      email: CASE_A.client_email,
      pin: validPin,
    });

    expect(session).not.toHaveProperty('token');
    expect(session).not.toHaveProperty('handoff_token');
    expect(session).not.toHaveProperty('admin');
    // Login must never touch the withdrawal or phase-advance gates.
    const sql = mockDataSource.query.mock.calls
      .map((call: unknown[]) => String(call[0]))
      .join('\n');
    expect(sql).not.toContain('vf_submit_withdrawal_request');
    expect(sql).not.toContain('vf_advance_case_phase');
    expect(sql).not.toContain('vf_issue_phase6_handoff');
  });

  it('10. failed PIN attempts are rate-limited to a lockout', async () => {
    mockDataSource.query
      .mockResolvedValueOnce(rowWithPin({ pin_attempts: 4 }))
      .mockResolvedValueOnce([]); // increments to 5 → sets pin_locked_until

    await expect(
      service.login({
        referenceId: CASE_A.case_number,
        email: CASE_A.client_email,
        pin: '000000',
      }),
    ).rejects.toThrow(CLIENT_AUTH_GENERIC_ERROR);

    const updateSql = (
      mockDataSource.query.mock.calls as Array<Array<string>>
    )[1][0];
    expect(updateSql).toContain('pin_attempts = pin_attempts + 1');
    expect(updateSql).toContain('make_interval');
  });

  const admin = {
    actorId: 'a0000000-0000-4000-8000-000000000001',
    organizationId: CASE_A.organization_id,
    role: 'admin',
    supabaseUserId: 'supabase-admin',
  };

  it('11. an administrator can set a client PIN without receiving it back', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([CASE_A])
      .mockResolvedValueOnce([]); // upsert pin hash

    const result = await service.resetPin(
      CASE_A.case_number,
      validPin,
      validPin,
      admin,
    );

    expect(result.case_number).toBe(CASE_A.case_number);
    expect(result.success).toBe(true);
    expect('pin' in result).toBe(false);
    const upsertSql = (
      mockDataSource.query.mock.calls as Array<Array<string>>
    )[1][0];
    expect(upsertSql).toContain('ON CONFLICT (case_id)');
    const upsertParams = (
      mockDataSource.query.mock.calls as Array<Array<string>>
    )[1][1];
    expect(upsertParams).toContain(CASE_A.client_id);
    expect(upsertParams).toContain(CASE_A.case_id);
    expect(upsertParams[2]).not.toBe(validPin); // only the bcrypt hash is stored
  });

  it('11b. a client actor cannot reset a PIN (administrator access required)', async () => {
    await expect(
      service.resetPin(CASE_A.case_number, validPin, validPin, {
        ...admin,
        role: 'client',
      }),
    ).rejects.toThrow(/administrator access required/);
    expect(mockDataSource.query).toHaveBeenCalledTimes(0);
  });

  it('11c. resetting a PIN for an unknown case is rejected', async () => {
    mockDataSource.query.mockResolvedValueOnce([]); // no matching case

    await expect(
      service.resetPin('VF-2026-9999', validPin, validPin, admin),
    ).rejects.toThrow(/case not found/);
  });

  it('11d. rejects non-six-digit PIN values before persistence', async () => {
    await expect(
      service.resetPin(CASE_A.case_number, '12345', '12345', admin),
    ).rejects.toThrow(/exactly 6 digits/);
    expect(mockDataSource.query).not.toHaveBeenCalled();
  });

  it('11e. rejects a mismatched confirmation before persistence', async () => {
    await expect(
      service.resetPin(CASE_A.case_number, validPin, '000000', admin),
    ).rejects.toThrow(/match/);
    expect(mockDataSource.query).not.toHaveBeenCalled();
  });

  it('11f. accepts a matching leading-zero PIN as a string', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([CASE_A])
      .mockResolvedValueOnce([]);
    await expect(
      service.resetPin(CASE_A.case_number, '012345', '012345', admin),
    ).resolves.toEqual({ case_number: CASE_A.case_number, success: true });
    const upsertParams = (
      mockDataSource.query.mock.calls as Array<Array<unknown>>
    )[1][1] as unknown[];
    expect(upsertParams[2]).not.toBe('012345');
  });

  it('11g. rejects a case belonging to another organization without persistence', async () => {
    mockDataSource.query.mockResolvedValueOnce([]);
    await expect(
      service.resetPin(CASE_A.case_number, validPin, validPin, {
        ...admin,
        organizationId: 'other-org',
      }),
    ).rejects.toThrow(/case not found/);
    expect(mockDataSource.query).toHaveBeenCalledTimes(1);
  });

  it('12. updates only authorized profile fields and audits field names', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([
        {
          id: CASE_A.case_id,
          case_number: CASE_A.case_number,
          client_id: CASE_A.client_id,
          organization_id: CASE_A.organization_id,
        },
      ])
      .mockResolvedValueOnce([
        {
          id: CASE_A.client_id,
          name: 'Updated Name',
          email: CASE_A.client_email,
        },
      ])
      .mockResolvedValueOnce([]);
    const result = await service.updateProfile(
      CASE_A.case_number,
      { caseNumber: CASE_A.case_number, name: 'Updated Name' },
      admin,
    );
    expect(result.client.name).toBe('Updated Name');
    expect(auditLogsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLIENT_PROFILE_UPDATED',
        changes: { fields: ['name'] },
      }),
    );
  });

  it('13. rejects profile changes for another organization', async () => {
    mockDataSource.query.mockResolvedValueOnce([]);
    await expect(
      service.updateProfile(
        CASE_A.case_number,
        { caseNumber: CASE_A.case_number, name: 'Nope' },
        { ...admin, organizationId: 'other-org' },
      ),
    ).rejects.toThrow(/case not found/);
  });
});
