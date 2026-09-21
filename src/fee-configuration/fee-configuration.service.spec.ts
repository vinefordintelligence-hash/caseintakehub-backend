import { Test, TestingModule } from '@nestjs/testing';
import { FeeConfigurationService } from './fee-configuration.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FeeDefinition } from './fee-definition.entity';
import { FeeComponent } from './fee-component.entity';
import { FeeSnapshot } from './fee-snapshot.entity';
import { Repository } from 'typeorm';
import { VerifiedIdentity } from '../identity/supabase-identity.service';

describe('FeeConfigurationService', () => {
  let service: FeeConfigurationService;
  let defRepo: Repository<FeeDefinition>;
  let compRepo: Repository<FeeComponent>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeeConfigurationService,
        {
          provide: getRepositoryToken(FeeDefinition),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            findOneBy: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(FeeComponent),
          useValue: { findBy: jest.fn(), findOne: jest.fn(), save: jest.fn() },
        },
        { provide: getRepositoryToken(FeeSnapshot), useValue: {} },
      ],
    }).compile();

    service = module.get<FeeConfigurationService>(FeeConfigurationService);
    defRepo = module.get<Repository<FeeDefinition>>(
      getRepositoryToken(FeeDefinition),
    );
    compRepo = module.get<Repository<FeeComponent>>(
      getRepositoryToken(FeeComponent),
    );
  });

  it('should calculate fixed and percentage fees with VAT correctly', async () => {
    const mockDef = {
      id: 'def1',
      vatRate: '0.0750',
      currency: 'USD',
    } as FeeDefinition;
    const mockComps = [
      {
        name: 'Fixed Fee',
        type: 'FIXED',
        value: '10.00',
        isVatable: false,
        ordering: 1,
      },
      {
        name: 'Service Fee',
        type: 'PERCENT',
        value: '5.00',
        isVatable: true,
        ordering: 2,
      },
    ] as FeeComponent[];

    jest.spyOn(defRepo, 'findOneBy').mockResolvedValue(mockDef);
    jest.spyOn(compRepo, 'findBy').mockResolvedValue(mockComps);

    const result = await service.calculate('def1', '100.00');

    expect(result.subtotal).toBe('15.00');
    expect(result.vatAmount).toBe('0.37');
    expect(result.total).toBe('15.37');
  });

  it('should list definitions', async () => {
    const mockDefs = [{ id: '1' }] as FeeDefinition[];
    jest.spyOn(defRepo, 'find').mockResolvedValue(mockDefs);
    const result = await service.listDefinitions({
      organizationId: 'org1',
    } as VerifiedIdentity);
    expect(result).toBe(mockDefs);
  });

  it('should update definition', async () => {
    const mockDef = { id: '1', isActive: false } as FeeDefinition;
    jest.spyOn(defRepo, 'findOneBy').mockResolvedValue(mockDef);
    jest
      .spyOn(defRepo, 'save')
      .mockImplementation((x) => Promise.resolve(x as FeeDefinition));
    const result = await service.updateDefinition(
      '1',
      'org1',
      { isActive: true },
      'actor1',
    );
    expect(result.isActive).toBe(true);
  });

  it('should update component', async () => {
    const mockComp = {
      id: 'comp1',
      definition: { organizationId: 'org1' },
    } as FeeComponent;
    jest.spyOn(compRepo, 'findOne').mockResolvedValue(mockComp);
    jest
      .spyOn(compRepo, 'save')
      .mockImplementation((x) => Promise.resolve(x as FeeComponent));
    const result = await service.updateComponent('def1', 'comp1', 'org1', {
      isActive: false,
    });
    expect(result.isActive).toBe(false);
  });
});
