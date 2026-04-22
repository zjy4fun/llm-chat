import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { DB } from './db.js';
import {
  getUserById,
  getUserByEmail,
  isRefreshTokenActive,
  revokeRefreshToken,
  saveRefreshToken,
  type UserRecord
} from './db.js';
import type { AuthContext } from '../types/chat.js';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const ACCESS_SECRET = process.env.JWT_SECRET || 'dev-access-secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret';

interface JWTPayload {
  sub: string;
  email: string;
  plan: 'free' | 'pro';
  type: 'access' | 'refresh';
}

function toAuthContext(user: UserRecord): AuthContext {
  return {
    userId: user.id,
    plan: user.plan,
    balance: user.active ? 1 : 0
  };
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

function tokenHash(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function signToken(payload: JWTPayload, expiresInSeconds: number, secret: string): string {
  return jwt.sign(payload, secret, {
    expiresIn: expiresInSeconds,
    issuer: 'llm-chat'
  });
}

export function issueAuthTokens(db: DB, user: UserRecord): { access_token: string; refresh_token: string; expires_in: number } {
  const payloadBase = {
    sub: user.id,
    email: user.email,
    plan: user.plan
  };

  const accessToken = signToken({ ...payloadBase, type: 'access' }, ACCESS_TOKEN_TTL_SECONDS, ACCESS_SECRET);
  const refreshToken = signToken({ ...payloadBase, type: 'refresh' }, REFRESH_TOKEN_TTL_SECONDS, REFRESH_SECRET);

  saveRefreshToken(db, {
    userId: user.id,
    tokenHash: tokenHash(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString()
  });

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: ACCESS_TOKEN_TTL_SECONDS
  };
}

function verifyToken(rawToken: string, secret: string): JWTPayload {
  const parsed = jwt.verify(rawToken, secret, { issuer: 'llm-chat' }) as JWTPayload;
  if (!parsed?.sub || !parsed?.type) {
    throw new Error('invalid token');
  }
  return parsed;
}

export function authenticateAccessToken(db: DB, rawToken: string): AuthContext {
  const payload = verifyToken(rawToken, ACCESS_SECRET);
  if (payload.type !== 'access') {
    throw Object.assign(new Error('invalid access token type'), { status: 401, code: 'AUTH_INVALID_TOKEN' });
  }

  const user = getUserById(db, payload.sub);
  if (!user || !user.active) {
    throw Object.assign(new Error('user not found or inactive'), { status: 403, code: 'AUTH_INVALID_USER' });
  }

  return toAuthContext(user);
}

export function rotateRefreshToken(db: DB, refreshToken: string): { access_token: string; refresh_token: string; expires_in: number } {
  const payload = verifyToken(refreshToken, REFRESH_SECRET);
  if (payload.type !== 'refresh') {
    throw Object.assign(new Error('invalid refresh token type'), { status: 401, code: 'AUTH_INVALID_TOKEN' });
  }

  const hashed = tokenHash(refreshToken);
  if (!isRefreshTokenActive(db, hashed)) {
    throw Object.assign(new Error('refresh token is expired or revoked'), { status: 401, code: 'AUTH_REFRESH_REVOKED' });
  }

  revokeRefreshToken(db, hashed);

  const user = getUserById(db, payload.sub);
  if (!user || !user.active) {
    throw Object.assign(new Error('user not found or inactive'), { status: 403, code: 'AUTH_INVALID_USER' });
  }

  return issueAuthTokens(db, user);
}

export function authGuard(auth: AuthContext): AuthContext {
  if (!auth?.userId) {
    throw Object.assign(new Error('unauthorized'), { code: 'AUTH_MISSING_TOKEN', status: 401 });
  }

  return auth;
}

export function extractBearerToken(req: Request): string {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw Object.assign(new Error('missing Bearer token'), { status: 401, code: 'AUTH_MISSING_TOKEN' });
  }

  return authHeader.slice('Bearer '.length).trim();
}

export function requireAuth(db: DB) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        const token = extractBearerToken(req);
        req.auth = authenticateAccessToken(db, token);
        next();
        return;
      }

      const legacyUserId = (req.body?.user_id ?? req.query?.user_id) as string | undefined;
      if (legacyUserId) {
        const user = getUserById(db, legacyUserId);
        if (!user || !user.active) {
          throw Object.assign(new Error('user not found or inactive'), { status: 403, code: 'AUTH_INVALID_USER' });
        }
        req.auth = toAuthContext(user);
        next();
        return;
      }

      throw Object.assign(new Error('missing Bearer token'), { status: 401, code: 'AUTH_MISSING_TOKEN' });
    } catch (error) {
      next(error);
    }
  };
}

export function assertLoginCredentials(db: DB, email: string, password: string): UserRecord {
  const user = getUserByEmail(db, email);
  if (!user || !user.active) {
    throw Object.assign(new Error('invalid credentials'), { status: 401, code: 'AUTH_INVALID_CREDENTIALS' });
  }

  return user;
}
