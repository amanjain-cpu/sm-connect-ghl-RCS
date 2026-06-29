import type { CookieOptions, Request, Response } from 'express';
import { config } from '../config/index.js';

export const ACCESS_TOKEN_COOKIE_NAME = 'sm_access_token';
export const REFRESH_TOKEN_COOKIE_NAME = 'sm_refresh_token';

const ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isSecureRequest(req: Request): boolean {
  const forwardedProto = req.get('x-forwarded-proto');
  return req.secure || forwardedProto === 'https' || config.nodeEnv === 'production';
}

function buildCookieOptions(req: Request, maxAge: number): CookieOptions {
  const secure = isSecureRequest(req);

  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    path: '/',
    maxAge,
  };
}

export function setAuthCookies(
  req: Request,
  res: Response,
  tokens: { accessToken: string; refreshToken: string }
): void {
  res.cookie(
    ACCESS_TOKEN_COOKIE_NAME,
    tokens.accessToken,
    buildCookieOptions(req, ACCESS_TOKEN_MAX_AGE_MS)
  );
  res.cookie(
    REFRESH_TOKEN_COOKIE_NAME,
    tokens.refreshToken,
    buildCookieOptions(req, REFRESH_TOKEN_MAX_AGE_MS)
  );
}

export function clearAuthCookies(req: Request, res: Response): void {
  const accessCookieOptions = buildCookieOptions(req, ACCESS_TOKEN_MAX_AGE_MS);
  const refreshCookieOptions = buildCookieOptions(req, REFRESH_TOKEN_MAX_AGE_MS);

  res.clearCookie(ACCESS_TOKEN_COOKIE_NAME, accessCookieOptions);
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, refreshCookieOptions);
}

export function getAccessTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  const cookieToken = req.cookies?.[ACCESS_TOKEN_COOKIE_NAME];
  return typeof cookieToken === 'string' && cookieToken.length > 0 ? cookieToken : null;
}

export function getRefreshTokenFromRequest(req: Request): string | null {
  const cookieToken = req.cookies?.[REFRESH_TOKEN_COOKIE_NAME];
  return typeof cookieToken === 'string' && cookieToken.length > 0 ? cookieToken : null;
}
