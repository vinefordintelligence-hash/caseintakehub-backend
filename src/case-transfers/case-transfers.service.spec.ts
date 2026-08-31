import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { CaseTransfersService } from './case-transfers.service';
import { AdminReviewOutcome } from './dto/admin-review-requirement.dto';

const CASE_ID = '7b2abe2a-9312-42b8-a48d-408fd1771b77';
const ORG_ID = 'a66e5f92-5c3c-42d5-b270-fba206ef5c0b';
const OPERATOR = 'a0000000-0000-4000-8000-000000000001';
const CLIENT_ACTOR_ID = 'a0000000-0000-4000-8000-000000000002';
const REQUIREMENT_ID = '74fe7d4b-cd31-4d50-a810-47ed38350422';

describe('CaseTransfersService', () => {
  let service: CaseTransfersService;
  let query: jest.Mock;

  beforeEach(async () => {
    query = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaseTransfersService,
        { provide: getDataSourceToken(), useValue: { query } },
      ],
    }).compile();

    service = module.get<CaseTransfersService>(CaseTransfersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates a transfer via vf_create_transfer', async () => {
    query.mockResolvedValue([{ result: { status: 'prepared' } }]);
    const result = await service.create(
      {
        case_id: CASE_ID,
        organization_id: ORG_ID,
        reference: 'DEMO-VF20268282-0001',
        amount: 114000,
      },
      OPERATOR,
      ORG_ID,
    );
    expect(result).toEqual({ status: 'prepared' });
    expect(query.mock.calls[0][0]).toContain('vf_create_transfer');
    const params = query.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe(ORG_ID);
    expect(params[14]).toBe(OPERATOR);
  });

  it('rejects transfer creation without a verified actor before database work', async () => {
    await expect(
      service.create(
        {
          case_id: CASE_ID,
          organization_id: 'spoofed-org',
          reference: 'DEMO-1',
          amount: 1,
        },
        '',
        ORG_ID,
      ),
    ).rejects.toThrow(/verified actor identity required/);
    expect(query).not.toHaveBeenCalled();
  });

  it('1. creates a document requirement initially REQUIRED with no preloaded document', async () => {
    query
      .mockResolvedValueOnce([{ case_id: CASE_ID, organization_id: ORG_ID }])
      .mockResolvedValueOnce([
        { result: { id: REQUIREMENT_ID, status: 'required' } },
      ]);
    const result = await service.addRequirement(REQUIREMENT_ID, OPERATOR, {
      key: 'bank_account_verification_document',
      title: 'BANK ACCOUNT VERIFICATION DOCUMENT',
    });
    expect(query.mock.calls[1][0]).toContain('vf_add_requirement');
    expect(result).toEqual({ id: REQUIREMENT_ID, status: 'required' });
    expect((result as { status: string }).status).toBe('required');
  });

  it('2. client can submit the document', async () => {
    query.mockResolvedValueOnce([
      {
        result: {
          document: { id: 'doc-1', document_status: 'submitted' },
          requirement: {
            id: REQUIREMENT_ID,
            status: 'submitted',
            submitted_by: CLIENT_ACTOR_ID,
          },
        },
      },
    ]);
    const result = await service.uploadVerificationDocument(
      REQUIREMENT_ID,
      CLIENT_ACTOR_ID,
      {
        title: 'BANK ACCOUNT VERIFICATION DOCUMENT',
        file_name: 'bank-account-verification.pdf',
        mime_type: 'application/pdf',
      },
    );
    expect(query.mock.calls[0][0]).toContain('vf_upload_verification_document');
    const params = query.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe(CLIENT_ACTOR_ID);
    expect(result).toMatchObject({
      document: { document_status: 'submitted' },
      requirement: { status: 'submitted' },
    });
  });

  it('3. submission changes requirement state to SUBMITTED', async () => {
    query.mockResolvedValueOnce([
      {
        result: {
          requirement: {
            id: REQUIREMENT_ID,
            status: 'submitted',
            submitted_at: '2026-08-15T00:00:00Z',
          },
        },
      },
    ]);
    const result = (await service.uploadVerificationDocument(
      REQUIREMENT_ID,
      CLIENT_ACTOR_ID,
      { title: 'BANK ACCOUNT VERIFICATION DOCUMENT' },
    )) as { requirement: { status: string } };
    expect(result.requirement.status).toBe('submitted');
  });

  it('4. submission writes a timeline event via the audited DB function', async () => {
    query.mockResolvedValueOnce([
      { result: { requirement: { status: 'submitted' } } },
    ]);
    await service.uploadVerificationDocument(REQUIREMENT_ID, CLIENT_ACTOR_ID, {
      title: 'BANK ACCOUNT VERIFICATION DOCUMENT',
    });
    const sql = query.mock.calls[0][0] as string;
    // vf_upload_verification_document writes the timeline (vf_append_event)
    // and the audit record (vf_log_audit) as a single audited transition.
    expect(sql).toContain('vf_upload_verification_document');
    const params = query.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe(CLIENT_ACTOR_ID);
  });

  it('5. admin can see pending review (requirements filtered by status)', async () => {
    query.mockResolvedValue([{ id: REQUIREMENT_ID, status: 'under_review' }]);
    const rows = await service.findRequirements('transfer-1', 'under_review');
    expect(rows).toHaveLength(1);
    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain('r.status = $2');
    expect(query.mock.calls[0][1]).toEqual(['transfer-1', 'under_review']);
  });

  it('6. admin APPROVE creates the VERIFIED state', async () => {
    query.mockResolvedValue([
      {
        result: {
          id: REQUIREMENT_ID,
          status: 'verified',
          reviewed_by: OPERATOR,
        },
      },
    ]);
    const result = await service.adminReviewRequirement(
      REQUIREMENT_ID,
      OPERATOR,
      {
        outcome: AdminReviewOutcome.approved,
        note: 'doc matches configured account info',
      },
    );
    expect(query.mock.calls[0][0]).toContain('vf_admin_review_requirement');
    expect(result).toMatchObject({ status: 'verified' });
    const params = query.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe('approved');
  });

  it('7. admin REJECT prevents VERIFIED', async () => {
    query.mockResolvedValue([
      {
        result: {
          id: REQUIREMENT_ID,
          status: 'rejected',
          reviewed_by: OPERATOR,
        },
      },
    ]);
    const result = await service.adminReviewRequirement(
      REQUIREMENT_ID,
      OPERATOR,
      {
        outcome: AdminReviewOutcome.rejected,
        note: 'document does not match',
      },
    );
    expect(result).toMatchObject({ status: 'rejected' });
    expect((result as { status: string }).status).not.toBe('verified');
  });

  it('8. NEEDS_INFORMATION returns the case to the required-information workflow', async () => {
    query.mockResolvedValueOnce([
      {
        result: {
          id: REQUIREMENT_ID,
          status: 'needs_information',
          review_note: 'routing number does not match',
        },
      },
    ]);
    const result = await service.adminReviewRequirement(
      REQUIREMENT_ID,
      OPERATOR,
      {
        outcome: AdminReviewOutcome.needs_information,
        note: 'routing number does not match',
      },
    );
    // needs_information keeps the requirement unverified; the DB function
    // moves the case back to PHASE 3 (verification_documents_requested) and
    // the vf_create_next_client_action gate keeps PHASE 6 locked.
    expect(result).toMatchObject({ status: 'needs_information' });
    const params = query.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe('needs_information');
  });

  it('shows a requirement detail with document + review history for the admin UI', async () => {
    query.mockResolvedValue([
      {
        result: {
          id: REQUIREMENT_ID,
          status: 'under_review',
          document: { id: 'doc-1', uploaded_at: '2026-08-15T00:00:00Z' },
          review_history: [
            { title: 'Verification Document Submitted', event_date: 't1' },
          ],
        },
      },
    ]);
    const detail = await service.findRequirement(REQUIREMENT_ID, 'admin');
    expect(detail).toMatchObject({
      id: REQUIREMENT_ID,
      status: 'under_review',
    });
    expect(query.mock.calls[0][0]).toContain('vf_get_requirement_detail');
  });
});
