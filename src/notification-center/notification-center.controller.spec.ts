import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationCenterController } from './notification-center.controller';
import { NotificationCenterService } from './notification-center.service';
import { ActorService } from '../common/actor.service';
import { SupabaseIdentityService } from '../identity/supabase-identity.service';
import { CreateNotificationDto } from './dto/create-notification.dto';

const adminActor = {
  id: 'a0000000-0000-4000-8000-000000000001',
  role: 'admin',
  organization_id: 'org-1',
  name: 'Admin',
  email: 'admin@vineford.com',
};

describe('NotificationCenterController', () => {
  let controller: NotificationCenterController;
  let serviceMock: {
    list: jest.Mock;
    unreadCount: jest.Mock;
    markRead: jest.Mock;
    markAllRead: jest.Mock;
    create: jest.Mock;
  };
  let actorMock: { find: jest.Mock; requireAdmin: jest.Mock };

  beforeEach(async () => {
    serviceMock = {
      list: jest.fn().mockResolvedValue([]),
      unreadCount: jest.fn().mockResolvedValue(0),
      markRead: jest.fn().mockResolvedValue({ ok: true }),
      markAllRead: jest.fn().mockResolvedValue({ ok: true }),
      create: jest.fn().mockResolvedValue({ id: 'n-1' }),
    };
    actorMock = {
      find: jest.fn().mockResolvedValue(adminActor),
      requireAdmin: jest.fn().mockResolvedValue(adminActor),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationCenterController],
      providers: [
        { provide: SupabaseIdentityService, useValue: { verify: jest.fn() } },
        { provide: NotificationCenterService, useValue: serviceMock },
        { provide: ActorService, useValue: actorMock },
      ],
    }).compile();
    controller = module.get<NotificationCenterController>(
      NotificationCenterController,
    );
  });

  it('lists notifications with unread count', async () => {
    serviceMock.list.mockResolvedValueOnce([{ id: 'n-1' }]);
    serviceMock.unreadCount.mockResolvedValueOnce(1);
    const result = await controller.list('case-1', undefined, 'actor-1');
    expect(result).toEqual({ items: [{ id: 'n-1' }], unread: 1 });
  });

  it('marks a notification read', async () => {
    const result = await controller.markRead(
      'n-1',
      'case-1',
      undefined,
      'actor-1',
    );
    expect(serviceMock.markRead).toHaveBeenCalledWith(
      'n-1',
      adminActor,
      'case-1',
    );
    expect(result).toEqual({ ok: true });
  });

  it('creates a notification as an administrator', async () => {
    const result = await controller.create(
      {
        case_id: 'case-1',
        recipient_role: 'client',
        title: 'Document requested',
        body: 'Please upload',
      },
      'actor-1',
    );
    expect(serviceMock.create).toHaveBeenCalledWith({
      caseId: 'case-1',
      organizationId: 'org-1',
      recipientRole: 'client',
      title: 'Document requested',
      body: 'Please upload',
    });
    expect(result).toEqual({ id: 'n-1' });
  });

  it('keeps documented notification fields under the global whitelist', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    const value = await pipe.transform(
      {
        case_id: '7b2abe2a-9312-42b8-a48d-408fd1771b77',
        recipient_role: 'client',
        title: 'Document requested',
        body: 'Please upload',
      },
      { type: 'body', metatype: CreateNotificationDto },
    );
    expect(value).toEqual(
      expect.objectContaining({
        case_id: '7b2abe2a-9312-42b8-a48d-408fd1771b77',
        recipient_role: 'client',
        title: 'Document requested',
        body: 'Please upload',
      }),
    );
  });

  it('continues rejecting unknown notification fields', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    await expect(
      pipe.transform(
        {
          case_id: '7b2abe2a-9312-42b8-a48d-408fd1771b77',
          recipient_role: 'client',
          title: 'Document requested',
          unsafe: true,
        },
        { type: 'body', metatype: CreateNotificationDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
