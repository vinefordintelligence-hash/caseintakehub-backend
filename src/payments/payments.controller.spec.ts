import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { CasePaymentStatusEnum } from './dto/set-case-payment-status.dto';
import { SupabaseIdentityGuard } from '../identity/supabase-identity.guard';
import {
  SupabaseIdentityService,
  VerifiedIdentity,
} from '../identity/supabase-identity.service';

const identity: VerifiedIdentity = {
  actorId: 'actor-1',
  organizationId: 'org-a',
  role: 'admin',
  supabaseUserId: 'sub-a',
};
const req = { vfIdentity: identity } as never;

describe('PaymentsController', () => {
  let controller: PaymentsController;
  let service: PaymentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        {
          provide: SupabaseIdentityGuard,
          useValue: { canActivate: jest.fn() },
        },
        { provide: SupabaseIdentityService, useValue: { verify: jest.fn() } },
        {
          provide: PaymentsService,
          useValue: {
            getPaymentGate: jest.fn(),
            updatePaymentGate: jest.fn(),
            getPaymentGateAudit: jest.fn(),
            getCasePayment: jest.fn(),
            getCasePaymentClient: jest.fn(),
            setCasePaymentStatus: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<PaymentsController>(PaymentsController);
    service = module.get<PaymentsService>(PaymentsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('GET /payments/gate returns the global gate', () => {
    controller.getPaymentGate(req);
    expect(service.getPaymentGate).toHaveBeenCalledWith(identity);
  });

  it('PATCH /payments/gate updates the global gate (admin)', () => {
    controller.updatePaymentGate({ enabled: true }, req);
    expect(service.updatePaymentGate).toHaveBeenCalledWith(identity, {
      enabled: true,
    });
  });

  it('GET /payments/gate/audit returns audit history', () => {
    controller.getPaymentGateAudit(req);
    expect(service.getPaymentGateAudit).toHaveBeenCalledWith(identity);
  });

  it('PATCH /payments/cases/:caseId sets per-case payment status', () => {
    controller.setCasePaymentStatus(
      'case-1',
      {
        status: CasePaymentStatusEnum.paid,
        invoice_id: 'inv-1',
      },
      req,
    );
    expect(service.setCasePaymentStatus).toHaveBeenCalledWith(
      'case-1',
      identity,
      { status: CasePaymentStatusEnum.paid, invoice_id: 'inv-1' },
    );
  });
});
