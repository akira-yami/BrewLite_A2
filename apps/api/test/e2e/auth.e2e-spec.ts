// Kiểm tra JWT, hồ sơ, vai trò và quyền truy cập dữ liệu qua HTTP.
import { INestApplication } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { UserRepository } from '../../src/modules/auth/repositories/user.repository.js';

describe('JWT guard and current user (HTTP)', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const findById = vi.fn();
  const findByUsername = vi.fn();
  const loginPassword = 'AuthLoginE2E-Only-Password123!';
  let loginUser: typeof user;
  const user = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    username: 'huy',
    role: 'CUSTOMER',
    passwordHash: 'must-not-leak',
    loyaltyBalance: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeAll(async () => {
    loginUser = {
      ...user,
      passwordHash: await bcrypt.hash(loginPassword, 10),
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: vi.fn() })
      .overrideProvider(UserRepository)
      .useValue({ findById, findByUsername })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    jwt = app.get(JwtService);
  }, 30000);
  beforeEach(() => {
    findById.mockReset();
    findById.mockResolvedValue(user);
    findByUsername.mockReset();
    findByUsername.mockResolvedValue(loginUser);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('rejects a missing token without looking up a user', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    expect(findById).not.toHaveBeenCalled();
  });

  it('logs in with bcrypt credentials and returns a verifiable JWT in the data envelope', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: loginUser.username, password: loginPassword })
      .expect(200);

    expect(findByUsername).toHaveBeenCalledWith(loginUser.username);
    expect(response.body.data.user).toMatchObject({
      id: loginUser.id,
      username: loginUser.username,
      role: loginUser.role,
      isActive: true,
    });
    expect(response.body.data.user).not.toHaveProperty('passwordHash');
    expect(response.body.data.expiresIn).toBe(900);
    expect(jwt.verify(response.body.data.accessToken)).toMatchObject({
      sub: loginUser.id,
      username: loginUser.username,
      role: loginUser.role,
    });
  });

  it('rejects malformed tokens', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
    expect(findById).not.toHaveBeenCalled();
  });

  it.each([
    { expiresIn: -1 },
    { secret: 'wrong-signature-key' },
    { issuer: 'wrong-issuer' },
    { audience: 'wrong-audience' },
  ] satisfies JwtSignOptions[])(
    'rejects invalid claims or signature: %j',
    async (options) => {
      const token = jwt.sign(
        { sub: user.id, username: user.username, role: user.role },
        options,
      );
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      expect(findById).not.toHaveBeenCalled();
      expect(JSON.stringify(response.body)).not.toContain(token);
      expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
    },
  );

  it('rejects a signed token with no subject', async () => {
    const token = jwt.sign({ username: user.username, role: user.role });
    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    expect(findById).not.toHaveBeenCalled();
  });

  it('uses JWT subject for the profile and never exposes the password hash', async () => {
    const token = jwt.sign({
      sub: user.id,
      username: user.username,
      role: user.role,
    });
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(findById).toHaveBeenCalledWith(user.id);
    expect(response.body.data).toMatchObject({
      id: user.id,
      username: 'huy',
      role: 'CUSTOMER',
    });
    expect(response.body.data).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('must-not-leak');
  });

  it('formats 401 with standard UNAUTHORIZED envelope when unauthenticated', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .expect(401);
    expect(response.body).toHaveProperty('error');
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(response.body.error.message).toContain('Phiên đăng nhập đã hết hạn');
    expect(response.body.error).toHaveProperty('requestId');
  });

  describe('RBAC & Ownership Guard (User Isolation)', () => {
    const otherUserId = '999e4567-e89b-42d3-a456-426614174999';

    it('allows CUSTOMER to read their own user data via /auth/users/:userId', async () => {
      const token = jwt.sign({
        sub: user.id,
        username: user.username,
        role: 'CUSTOMER',
      });
      const response = await request(app.getHttpServer())
        .get(`/api/v1/auth/users/${user.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(findById).toHaveBeenCalledWith(user.id);
      expect(response.body.data.id).toBe(user.id);
    });

    it('Chặn CUSTOMER đọc dữ liệu người khác với FORBIDDEN_RESOURCE', async () => {
      const token = jwt.sign({
        sub: user.id,
        username: user.username,
        role: 'CUSTOMER',
      });
      const response = await request(app.getHttpServer())
        .get(`/api/v1/auth/users/${otherUserId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(response.body.error.code).toBe('FORBIDDEN_RESOURCE');
      expect(response.body.error.message).toBe('Bạn không có quyền truy cập dữ liệu của người dùng khác.');
    });

    it('allows BARISTA to read any user data via /auth/users/:userId (Elevated role)', async () => {
      const baristaToken = jwt.sign({
        sub: 'barista-uuid',
        username: 'barista01',
        role: 'BARISTA',
      });
      const response = await request(app.getHttpServer())
        .get(`/api/v1/auth/users/${otherUserId}`)
        .set('Authorization', `Bearer ${baristaToken}`)
        .expect(200);
      expect(findById).toHaveBeenCalledWith(otherUserId);
      expect(response.body.data.id).toBe(user.id);
    });

    it('blocks CUSTOMER from accessing BARISTA-only route with FORBIDDEN_RESOURCE', async () => {
      const customerToken = jwt.sign({
        sub: user.id,
        username: user.username,
        role: 'CUSTOMER',
      });
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/barista-only')
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(403);
      expect(response.body.error.code).toBe('FORBIDDEN_RESOURCE');
      expect(response.body.error.message).toBe('Bạn không có quyền truy cập chức năng này.');
    });

    it('allows BARISTA to access BARISTA-only route', async () => {
      const baristaToken = jwt.sign({
        sub: 'barista-uuid',
        username: 'barista01',
        role: 'BARISTA',
      });
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/barista-only')
        .set('Authorization', `Bearer ${baristaToken}`)
        .expect(200);
      expect(response.body.data.message).toBe('Chào Barista');
    });
  });
});
