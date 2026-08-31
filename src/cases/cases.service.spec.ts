import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Case } from './entities/case.entity';
import { CasesService } from './cases.service';
import { CaseReferenceService } from './case-reference.service';

const mockRepository = {
  create: jest.fn((dto: Partial<Case>) => dto),
  save: jest.fn((entity: Case) => Promise.resolve(entity)),
  find: jest.fn(() => Promise.resolve([])),
  findOne: jest.fn(() => Promise.resolve(null)),
  remove: jest.fn(() => Promise.resolve(undefined)),
  query: jest.fn<Promise<any[]>, any[]>(() => Promise.resolve([])),
};
describe('CasesService', () => {
  let service: CasesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CasesService,
        CaseReferenceService,
        { provide: getRepositoryToken(Case), useValue: mockRepository },
      ],
    }).compile();

    service = module.get<CasesService>(CasesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('ignores caller-supplied references and uses the authoritative generator', async () => {
    mockRepository.query
      .mockResolvedValueOnce([{ id: 'client-a' }])
      .mockResolvedValueOnce([]);
    mockRepository.save.mockImplementationOnce(async (entity) => ({
      ...entity,
      id: 'case-a',
    }));
    const result = await service.create(
      {
        title: 'New case',
        client_id: 'client-a',
        case_number: 'CALLER-CONTROLLED',
      } as never,
      { organizationId: 'org-a', actorId: 'admin-a', role: 'admin' } as never,
    );
    expect(result.caseNumber).toMatch(/^VF-\d{4}-\d{4}$/);
    expect(result.caseNumber).not.toBe('CALLER-CONTROLLED');
  });
});
