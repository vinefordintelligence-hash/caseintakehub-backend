import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ClientAuthController } from './client-auth.controller';
import { ClientAuthService } from './client-auth.service';
import { SupabaseIdentityService } from '../identity/supabase-identity.service';
import { ResetClientPinDto } from './dto/reset-client-pin.dto';

describe('ClientAuthController', () => {
  let controller: ClientAuthController;
  let service: ClientAuthService;

  const mockService = {
    login: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientAuthController],
      providers: [
        { provide: ClientAuthService, useValue: mockService },
        { provide: SupabaseIdentityService, useValue: { verify: jest.fn() } },
      ],
    }).compile();

    controller = module.get<ClientAuthController>(ClientAuthController);
    service = module.get<ClientAuthService>(ClientAuthService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
    expect(service).toBeDefined();
  });

  it('POST /client-auth/login returns the client session context', async () => {
    const session = {
      sub: 'a0000000-0000-4000-8000-000000000002',
      role: 'client',
      name: 'Gayl M. Chenoweth',
      email: 'gayl302726@yahoo.com',
      organization_id: 'a66e5f92-5c3c-42d5-b270-fba206ef5c0b',
      client_id: '196b680d-e592-4d8a-a527-041931860f9a',
      case_id: '7b2abe2a-9312-42b8-a48d-408fd1771b77',
      case_number: 'VF-2026-8282',
    };
    mockService.login.mockResolvedValue(session);

    await expect(
      controller.login({
        referenceId: 'VF-2026-8282',
        email: 'gayl302726@yahoo.com',
        pin: '482913',
      }),
    ).resolves.toEqual(session);
    expect(mockService.login).toHaveBeenCalledWith({
      referenceId: 'VF-2026-8282',
      email: 'gayl302726@yahoo.com',
      pin: '482913',
    });
  });

  it('POST /client-auth/login surfaces the generic failure', async () => {
    mockService.login.mockRejectedValue(
      new Error('Unable to verify case access'),
    );

    await expect(
      controller.login({
        referenceId: 'VF-2026-8282',
        email: 'gayl302726@yahoo.com',
        pin: '000000',
      }),
    ).rejects.toThrow('Unable to verify case access');
  });

  describe('ResetClientPinDto request contract', () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const validate = (body: unknown) =>
      pipe.transform(body, { type: 'body', metatype: ResetClientPinDto });

    it('accepts matching six-digit strings, including a leading zero', async () => {
      await expect(
        validate({
          caseNumber: 'VF-TEST-0001',
          newPin: '012345',
          confirmPin: '012345',
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          caseNumber: 'VF-TEST-0001',
          newPin: '012345',
          confirmPin: '012345',
        }),
      );
    });

    it.each([
      ['too short', '12345'],
      ['too long', '1234567'],
      ['nonnumeric', '12a456'],
    ])('rejects a %s PIN', async (_label, pin) => {
      await expect(
        validate({ caseNumber: 'VF-TEST-0001', newPin: pin, confirmPin: pin }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects numeric PIN values so leading zeroes cannot be lost', async () => {
      await expect(
        validate({
          caseNumber: 'VF-TEST-0001',
          newPin: 12345,
          confirmPin: 12345,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
