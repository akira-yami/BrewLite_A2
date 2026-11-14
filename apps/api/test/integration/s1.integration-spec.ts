// Kiểm tra đăng ký, đăng nhập, hồ sơ và đọc menu trên PostgreSQL đã migrate.
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';

const connectionString = process.env.SMOKE_DATABASE_URL;
if (
  !connectionString ||
  !new URL(connectionString).pathname
    .slice(1)
    .startsWith('brewlite_foundation_smoke')
) {
  throw new Error(
    'S1 integration requires a disposable brewlite_foundation_smoke* database',
  );
}

describe('Sprint 1 module integration on migrated PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let registered: request.Response;
  let productId: string;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const username = `s1-${randomUUID()}`;
  const password = 'S1-local-test-only!';

  beforeAll(async () => {
    // Construct every app Prisma provider against the explicit disposable DB.
    process.env.DATABASE_URL = connectionString;
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
    const product = await prisma.product.create({
      data: {
        sku: `S1-${randomUUID()}`,
        name: 'S1 integration coffee',
        imageUrl: '/s1-test.png',
        variants: {
          create: [
            {
              size: 'M',
              price: 40000n,
              // 30g cà phê trong kho / 10g mỗi ly = tối đa 3 ly.
              recipeItems: {
                create: {
                  quantity: 10,
                  ingredient: {
                    create: {
                      code: `S1-BEAN-${randomUUID()}`,
                      name: 'S1 coffee beans',
                      unit: 'G',
                      stockQuantity: 30,
                    },
                  },
                },
              },
            },
            { size: 'L', price: 50000n, isActive: false },
          ],
        },
      },
    });
    productId = product.id;
    registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ username, password })
      .expect(201);
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('registers a real customer with a persisted hash and a safe response', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    expect(user.passwordHash).not.toBe(password);
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(registered.body.data.user).toMatchObject({
      id: user.id,
      username,
      role: 'CUSTOMER',
    });
    expect(registered.body.data.accessToken).toEqual(expect.any(String));
    expect(JSON.stringify(registered.body)).not.toContain('passwordHash');
    expect(JSON.stringify(registered.body)).not.toContain(user.passwordHash);
  });

  it('connects login, JWT verification and profile reads to the same user', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username, password })
      .expect(200);
    const profile = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .expect(200);
    expect(profile.body.data.id).toBe(registered.body.data.user.id);
    expect(profile.body.data.role).toBe('CUSTOMER');
    expect(profile.body.data).not.toHaveProperty('passwordHash');
  });

  it('rejects duplicate accounts, bad credentials and unauthenticated profile reads', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ username, password })
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username, password: 'wrong-password' })
      .expect(401);
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });

  it('enforces the global validation whitelist before inserting a user', async () => {
    const forbiddenUsername = `s1-${randomUUID()}`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ username: forbiddenUsername, password, role: 'BARISTA' })
      .expect(400);
    expect(
      await prisma.user.findUnique({ where: { username: forbiddenUsername } }),
    ).toBeNull();
  });

  it('serves JSON-safe catalog prices from PostgreSQL and omits inactive variants', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    const menu = await request(app.getHttpServer())
      .get('/api/v1/products')
      .expect(200);
    const product = menu.body.data.find(
      (entry: { id: string }) => entry.id === productId,
    );
    expect(product).toMatchObject({ id: productId, basePrice: 40000 });
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0]).toMatchObject({
      size: 'M',
      price: 40000,
      available: true,
    });
    expect(product.variants[0]).not.toHaveProperty('stock');
  });
});
