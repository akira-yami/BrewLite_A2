import { createHmac, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';

export interface JwtPayload {
  sub: string;        // user UUID
  role: 'CUSTOMER' | 'BARISTA';
  iat?: number;
  exp?: number;
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64url');
}

function sign(payload: object, secret: string, expiresInSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = base64url(JSON.stringify({ ...payload, iat: now, exp: now + expiresInSeconds }));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verify(token: string, secret: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const [header, body, sig] = parts;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  // constant-time compare — lengths must match before timingSafeEqual
  const a = Buffer.from(sig, 'base64url');
  const b = Buffer.from(expected, 'base64url');
  let valid = a.length === b.length;
  if (valid) {
    try {
      valid = timingSafeEqual(a, b);
    } catch {
      valid = false;
    }
  }
  if (!valid) throw new Error('invalid signature');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as JwtPayload & { exp: number };
  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('token expired');
  }
  return payload;
}

export const jwt = { sign, verify };
