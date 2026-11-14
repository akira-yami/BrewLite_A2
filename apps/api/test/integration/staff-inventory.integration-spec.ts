// Kiểm tra quyền xem tồn kho, bộ lọc, phân trang và quyền ghi qua HTTP với PostgreSQL.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';

const url = process.env.SMOKE_DATABASE_URL;
if (
  !url ||
  !new URL(url).pathname.slice(1).startsWith('brewlite_foundation_smoke')
)
  throw new Error('Use an isolated smoke database');

describe('Tồn kho nhân viên qua HTTP và PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let staff: string;
  let customer: string;
  let staffId: string;
  const previous = process.env.DATABASE_URL;
  const prefix = `INV-${randomUUID().slice(0, 8)}`;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const create = (stockQuantity = 1000) =>
    prisma.ingredient.create({
      data: {
        code: `${prefix}-${randomUUID()}`,
        name: 'Audit coffee beans',
        unit: 'G',
        stockQuantity,
      },
    });
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    prisma = app.get(PrismaService);
    const jwt = app.get(JwtService);
    for (const role of ['BARISTA', 'CUSTOMER'] as const) {
      const user = await prisma.user.create({
        data: { username: randomUUID(), passwordHash: 'test-only', role },
      });
      const token = jwt.sign({ sub: user.id, role, username: user.username });
      if (role === 'BARISTA') {
        staff = token;
        staffId = user.id;
      } else customer = token;
    }
  });
  afterAll(async () => {
    await app?.close();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  });

  it('Yêu cầu JWT và chặn CUSTOMER đọc danh sách, chi tiết hoặc ghi tồn kho', async () => {
    const item = await create();
    for (const path of ['/staff/inventory', `/staff/inventory/${item.id}`]) {
      await request(app.getHttpServer()).get(`/api/v1${path}`).expect(401);
      await request(app.getHttpServer())
        .get(`/api/v1${path}`)
        .set(bearer(customer))
        .expect(403);
    }
    await request(app.getHttpServer())
      .patch(`/api/v1/staff/inventory/${item.id}/stock`)
      .send({ stockQuantity: 0, version: 0 })
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/api/v1/staff/inventory/${item.id}/stock`)
      .set(bearer(customer))
      .send({ stockQuantity: 0, version: 0 })
      .expect(403);
    expect(
      (await prisma.ingredient.findUniqueOrThrow({ where: { id: item.id } }))
        .stockQuantity,
    ).toBe(1000);
  });

  it('Tìm kiếm, lọc theo mức tồn và phân trang không trùng dòng', async () => {
    const items = await Promise.all([create(0), create(100), create(1000)]);
    const first = await request(app.getHttpServer())
      .get(`/api/v1/staff/inventory?q=${prefix}&limit=2`)
      .set(bearer(staff))
      .expect(200);
    expect(first.body.data).toHaveLength(2);
    const second = await request(app.getHttpServer())
      .get(
        `/api/v1/staff/inventory?q=${prefix}&limit=2&cursor=${first.body.meta.nextCursor}`,
      )
      .set(bearer(staff))
      .expect(200);
    const ids = [...first.body.data, ...second.body.data].map(
      (i: { id: string }) => i.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const [index, status] of [
      'OUT_OF_STOCK',
      'LOW_STOCK',
      'IN_STOCK',
    ].entries()) {
      const result = await request(app.getHttpServer())
        .get(`/api/v1/staff/inventory?q=${prefix}&status=${status}`)
        .set(bearer(staff))
        .expect(200);
      expect(
        result.body.data.every((i: { status: string }) => i.status === status),
      ).toBe(true);
      expect(
        result.body.data.some((i: { id: string }) => i.id === items[index].id),
      ).toBe(true);
    }
  });

  it('Chi tiết hiển thị đơn vị, phiên bản và xác thực mã định danh', async () => {
    const item = await create();
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/staff/inventory/${item.id}`)
      .set(bearer(staff))
      .expect(200);
    expect(detail.body.data).toMatchObject({
      unit: 'G',
      version: 0,
      stockQuantity: 1000,
    });
    await request(app.getHttpServer())
      .get('/api/v1/staff/inventory/not-a-uuid')
      .set(bearer(staff))
      .expect(400);
    await request(app.getHttpServer())
      .get(`/api/v1/staff/inventory/${randomUUID()}`)
      .set(bearer(staff))
      .expect(404);
  });

  it('BARISTA được xem tồn nhưng không được đổi số lượng qua API', async () => {
    const item = await create();
    for (const data of [
      { stockQuantity: 0, version: 0 },
      { stockQuantity: 250, version: 0 },
      { stockQuantity: -1 },
      { role: 'MANAGER', stockQuantity: 0 },
    ]) {
      const result = await request(app.getHttpServer())
        .patch(`/api/v1/staff/inventory/${item.id}/stock`)
        .set(bearer(staff))
        .send(data)
        .expect(403);
      expect(result.body.error.code).toBe('FORBIDDEN_RESOURCE');
    }
    const row = await prisma.ingredient.findUniqueOrThrow({
      where: { id: item.id },
    });
    expect(row.stockQuantity).toBe(1000);
    expect(row.version).toBe(0);
  });

  it('BARISTA bị thu quyền không xem được hàng đợi hoặc tồn kho dù JWT còn hạn', async () => {
    await prisma.user.update({
      where: { id: staffId },
      data: { isActive: false },
    });
    await request(app.getHttpServer())
      .get('/api/v1/staff/inventory')
      .set(bearer(staff))
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/staff/orders')
      .set(bearer(staff))
      .expect(401);
    await prisma.user.update({
      where: { id: staffId },
      data: { isActive: true },
    });
  });
});
