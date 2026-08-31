import { Test, TestingModule } from '@nestjs/testing';
import { CaseTransfersController } from './case-transfers.controller';
import { CaseTransfersService } from './case-transfers.service';

describe('CaseTransfersController', () => {
  let controller: CaseTransfersController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CaseTransfersController],
      providers: [
        {
          provide: CaseTransfersService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            submitForReview: jest.fn(),
            verifyReceivingDetails: jest.fn(),
            addRequirement: jest.fn(),
            setRequirementStatus: jest.fn(),
            uploadVerificationDocument: jest.fn(),
            adminReviewRequirement: jest.fn(),
            findRequirements: jest.fn(),
            findRequirement: jest.fn(),
            execute: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<CaseTransfersController>(CaseTransfersController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
