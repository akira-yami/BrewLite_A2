// Kiểm tra HTTP readiness khi DB sẵn sàng hoặc gặp lỗi.
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';

describe('AppController (e2e)', () => {
  let app: INestApplication;
  let queryRaw: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    queryRaw = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: queryRaw })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  it('returns 503 without leaking DB credentials when readiness fails', async () => {
    queryRaw.mockRejectedValue(new Error('postgresql://private:secret@db'));
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(503);
    expect(response.body).toEqual({
      error: 'SERVICE_UNAVAILABLE',
      message: 'Service is not ready',
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('/api/v1/health checks the database before returning 200', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect({ success: true, data: { status: 'ok' } });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  afterEach(async () => {
    await app.close();
  });
});
