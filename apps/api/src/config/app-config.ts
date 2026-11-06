import { isIP } from 'node:net';

export interface VnpayConfig {
  enabled: boolean;
  tmnCode: string | null;
  hashSecret: string | null;
  paymentUrl: string;
  queryUrl: string;
  queryServerIp: string | null;
  returnUrl: string | null;
  ipnUrl: string | null;
  frontendOrigin: string;
}

export interface AppConfig {
  trustedProxyCidrs: string[];
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtExpiresInSeconds: number;
  orderReservationTtlMinutes: number;
  webOrigin: string;
  vnpay: VnpayConfig;
}

type Environment = Record<string, string | undefined>;
const MAX_JWT_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_ORDER_RESERVATION_TTL_MINUTES = 7 * 24 * 60;
export const VNPAY_SANDBOX_PAYMENT_URL =
  'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
export const VNPAY_SANDBOX_QUERY_URL =
  'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction';

function parseJwtExpiresIn(value: string | undefined): number {
  const normalized = value?.trim() || '15m';
  const match = /^(\d+)(s|m|h|d)$/i.exec(normalized);
  if (!match) {
    throw new Error('JWT_EXPIRES_IN must be a positive duration such as 15m, 900s, 1h, or 1d');
  }
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const secondsPerUnitByUnit: Record<string, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  const seconds = amount * secondsPerUnitByUnit[unit];
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > MAX_JWT_TTL_SECONDS) {
    throw new Error('JWT_EXPIRES_IN must resolve to a duration between 1 second and 7 days');
  }
  return seconds;
}

function parsePositiveInteger(name: string, value: string | undefined, defaultValue: number): number {
  const normalized = value?.trim();
  if (!normalized) return defaultValue;
  if (!/^\d+$/.test(normalized)) throw new Error(name + ' must be a positive integer');
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_ORDER_RESERVATION_TTL_MINUTES) {
    throw new Error(name + ' must be a positive integer no greater than 10080');
  }
  return parsed;
}

function requiredValue(name: string, value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(name + ' is required when VNPAY_ENABLED=true');
  return normalized;
}

function requireHttpsUrl(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(name + ' must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error(name + ' must be a valid HTTPS URL without credentials or fragments');
  }
  return url;
}

function parseTrustedProxyCidrs(value: string | undefined): string[] {
  const normalized = value?.trim();
  if (!normalized) return [];

  const entries = normalized.split(',');
  const cidrs = entries.map((rawEntry) => {
    const entry = rawEntry.trim();
    const parts = entry.split('/');
    if (!entry || parts.length > 2) {
      throw new Error('TRUSTED_PROXY_CIDRS must be a comma-separated list of literal IP addresses or CIDRs');
    }

    const address = parts[0];
    const family = isIP(address);
    if (family === 0) {
      throw new Error('TRUSTED_PROXY_CIDRS entries must use valid IPv4 or IPv6 addresses');
    }

    const maxPrefix = family === 4 ? 32 : 128;
    const prefix = parts.length === 1 ? maxPrefix : Number(parts[1]);
    if (
      (parts.length === 2 && !/^[0-9]+$/.test(parts[1])) ||
      !Number.isInteger(prefix) ||
      prefix <= 0 ||
      prefix > maxPrefix
    ) {
      throw new Error('TRUSTED_PROXY_CIDRS prefix must be between 1 and ' + maxPrefix + '; /0 is not allowed');
    }

    return address + '/' + prefix;
  });

  return [...new Set(cidrs)];
}

function loadVnpayConfig(env: Environment, webOrigin: string): VnpayConfig {
  const enabledRaw = env.VNPAY_ENABLED?.trim().toLowerCase() || 'false';
  if (enabledRaw !== 'true' && enabledRaw !== 'false') {
    throw new Error('VNPAY_ENABLED must be true or false');
  }

  const frontendOrigin = webOrigin.split(',')[0]?.trim() || 'http://localhost:3000';
  if (enabledRaw === 'false') {
    return {
      enabled: false,
      tmnCode: null,
      hashSecret: null,
      paymentUrl: VNPAY_SANDBOX_PAYMENT_URL,
      queryUrl: VNPAY_SANDBOX_QUERY_URL,
      queryServerIp: null,
      returnUrl: null,
      ipnUrl: null,
      frontendOrigin,
    };
  }

  const tmnCode = requiredValue('VNPAY_TMN_CODE', env.VNPAY_TMN_CODE);
  const hashSecret = requiredValue('VNPAY_HASH_SECRET', env.VNPAY_HASH_SECRET);
  if (!/^[A-Za-z0-9]{8}$/.test(tmnCode)) {
    throw new Error('VNPAY_TMN_CODE must contain exactly 8 alphanumeric characters');
  }
  if (hashSecret.length < 32) {
    throw new Error('VNPAY_HASH_SECRET must contain at least 32 characters');
  }

  const paymentUrlString =
    env.VNPAY_PAYMENT_URL?.trim() || VNPAY_SANDBOX_PAYMENT_URL;
  const paymentUrl = requireHttpsUrl('VNPAY_PAYMENT_URL', paymentUrlString);
  const paymentHost = paymentUrl.hostname.toLowerCase();
  if (
    !['sandbox.vnpayment.vn', 'pay.vnpay.vn'].includes(paymentHost) ||
    paymentUrl.search ||
    !paymentUrl.pathname.endsWith('/vpcpay.html')
  ) {
    throw new Error('VNPAY_PAYMENT_URL must use the official VNPay sandbox or production endpoint');
  }

  const queryUrl = requireHttpsUrl(
    'VNPAY_QUERY_URL',
    env.VNPAY_QUERY_URL?.trim() || VNPAY_SANDBOX_QUERY_URL,
  );
  if (
    !['sandbox.vnpayment.vn', 'merchant.vnpay.vn'].includes(queryUrl.hostname.toLowerCase()) ||
    queryUrl.search ||
    queryUrl.pathname !== '/merchant_webapi/api/transaction'
  ) {
    throw new Error('VNPAY_QUERY_URL must use the official VNPay QueryDr endpoint');
  }

  const queryServerIp = env.VNPAY_QUERY_SERVER_IP?.trim() || null;
  if (queryServerIp && isIP(queryServerIp) === 0) {
    throw new Error('VNPAY_QUERY_SERVER_IP must be a valid literal IPv4 or IPv6 address');
  }

  const returnUrl = requireHttpsUrl(
    'VNPAY_RETURN_URL',
    requiredValue('VNPAY_RETURN_URL', env.VNPAY_RETURN_URL),
  );
  const ipnUrl = requireHttpsUrl(
    'VNPAY_IPN_URL',
    requiredValue('VNPAY_IPN_URL', env.VNPAY_IPN_URL),
  );
  // Only isolated test runners may use a loopback HTTP frontend.
  // Production and development gateways still require HTTPS for WEB_ORIGIN.
  const frontend =
    env.NODE_ENV === 'test' &&
    /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?$/.test(frontendOrigin)
      ? new URL(frontendOrigin)
      : requireHttpsUrl('WEB_ORIGIN', frontendOrigin);

  return {
    enabled: true,
    tmnCode,
    hashSecret,
    paymentUrl: paymentUrl.toString(),
    queryUrl: queryUrl.toString(),
    queryServerIp,
    returnUrl: returnUrl.toString(),
    ipnUrl: ipnUrl.toString(),
    frontendOrigin: frontend.origin,
  };
}

export function loadAppConfig(env: Environment = process.env): AppConfig {
  const jwtSecret = env.JWT_SECRET?.trim();
  const isTest = env.NODE_ENV === 'test';
  if (!jwtSecret && !isTest) {
    throw new Error('JWT_SECRET environment variable is required and has no default fallback');
  }

  const webOrigin = env.WEB_ORIGIN?.trim() || 'http://localhost:3000';
  return {
    jwtSecret: jwtSecret || 'test-jwt-secret-for-isolated-tests-only-32bytes-long',
    jwtIssuer: env.JWT_ISSUER?.trim() || 'brewlite-api',
    jwtAudience: env.JWT_AUDIENCE?.trim() || 'brewlite-web',
    jwtExpiresInSeconds: parseJwtExpiresIn(env.JWT_EXPIRES_IN),
    orderReservationTtlMinutes: parsePositiveInteger(
      'ORDER_RESERVATION_TTL_MINUTES',
      env.ORDER_RESERVATION_TTL_MINUTES,
      15,
    ),
    webOrigin,
    trustedProxyCidrs: parseTrustedProxyCidrs(env.TRUSTED_PROXY_CIDRS),
    vnpay: loadVnpayConfig(env, webOrigin),
  };
}
