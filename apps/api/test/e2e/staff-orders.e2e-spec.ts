// Kiểm tra hàng đợi, cập nhật trạng thái đơn và phân quyền nhân viên qua HTTP.
import {
  ConflictException,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { OrdersService } from '../../src/modules/orders/services/orders.service.js';

describe('Staff orders API: JWT + RBAC (HTTP)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const getStaffQueue = vi.fn();
  const advanceOrderStatus = vi.fn();
  const orderId = '123e4567-e89b-42d3-a456-426614174000';
  const bearer = (role: 'CUSTOMER' | 'BARISTA') =>
    `Bearer ${jwt.sign({ sub: 'user-1', username: 'u', role })}`;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: vi.fn() })
      .overrideProvider(OrdersService)
      .useValue({ getStaffQueue, advanceOrderStatus })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    jwt = app.get(JwtService);
  }, 30000);

  beforeEach(() => {
    getStaffQueue.mockReset().mockResolvedValue({ data: [] });
    advanceOrderStatus.mockReset().mockResolvedValue({
      id: orderId,
      status: 'PREPARING',
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  const routes = [
    ['get', '/api/v1/staff/orders'],
    ['patch', `/api/v1/staff/orders/${orderId}/status`],
  ] as const;

  it.each(routes)('%s %s: thiếu token → 401', async (method, path) => {
    await request(app.getHttpServer())[method](path).expect(401);
    expect(getStaffQueue).not.toHaveBeenCalled();
    expect(advanceOrderStatus).not.toHaveBeenCalled();
  });

  it.each(routes)('%s %s: CUSTOMER → 403 FORBIDDEN_RESOURCE', async (method, path) => {
    const response = await request(app.getHttpServer())
      [method](path)
      .set('Authorization', bearer('CUSTOMER'))
      .send({ status: 'PREPARING' })
      .expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN_RESOURCE');
    expect(getStaffQueue).not.toHaveBeenCalled();
    expect(advanceOrderStatus).not.toHaveBeenCalled();
  });

  it('BARISTA xem được hàng đợi', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/staff/orders?status=PAID')
      .set('Authorization', bearer('BARISTA'))
      .expect(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.meta.requestId).toEqual(expect.any(String));
    expect(getStaffQueue).toHaveBeenCalledWith(expect.objectContaining({ status: 'PAID' }), 'user-1');
  });

  it('BARISTA đổi trạng thái; id barista lấy từ token', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/staff/orders/${orderId}/status`)
      .set('Authorization', bearer('BARISTA'))
      .send({ status: 'PREPARING' })
      .expect(200);
    expect(response.body.data.status).toBe('PREPARING');
    expect(advanceOrderStatus).toHaveBeenCalledWith(
      orderId,
      'user-1',
      'PREPARING',
    );
  });

  it.each(['PAID', 'CANCELLED', 'PENDING', 'NOPE'])(
    'BARISTA không thể đặt trạng thái %s → 400',
    async (status) => {
      await request(app.getHttpServer())
        .patch(`/api/v1/staff/orders/${orderId}/status`)
        .set('Authorization', bearer('BARISTA'))
        .send({ status })
        .expect(400);
      expect(advanceOrderStatus).not.toHaveBeenCalled();
    },
  );

  it('từ chối id không phải UUID và trường thừa', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/staff/orders/not-a-uuid/status')
      .set('Authorization', bearer('BARISTA'))
      .send({ status: 'READY' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/staff/orders/${orderId}/status`)
      .set('Authorization', bearer('BARISTA'))
      .send({ status: 'READY', userId: 'x' })
      .expect(400);
    expect(advanceOrderStatus).not.toHaveBeenCalled();
  });

  it('chuyển tiếp không hợp lệ → 409 INVALID_ORDER_TRANSITION', async () => {
    advanceOrderStatus.mockRejectedValue(
      new ConflictException({
        error: {
          code: 'INVALID_ORDER_TRANSITION',
          message: 'Không thể chuyển đơn từ PAID sang COMPLETED.',
          details: [{ from: 'PAID', to: 'COMPLETED' }],
        },
      }),
    );
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/staff/orders/${orderId}/status`)
      .set('Authorization', bearer('BARISTA'))
      .send({ status: 'COMPLETED' })
      .expect(409);
    expect(response.body.error.code).toBe('INVALID_ORDER_TRANSITION');
  });

  it('BARISTA vẫn không dùng được API đặt đơn của khách', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/orders/me')
      .set('Authorization', bearer('BARISTA'))
      .expect(403);
  });
});
