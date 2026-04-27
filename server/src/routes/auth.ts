import { Router } from 'express';
import { z } from 'zod';
import { hashPassword, issueAuthTokens, rotateRefreshToken, verifyPassword } from '../core/auth.js';
import { createUser, getUserByEmail, type DB } from '../core/db.js';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const refreshSchema = z.object({
  refresh_token: z.string().min(1)
});

export function createAuthRouter({ db }: { db: DB }) {
  const router = Router();

  router.post('/register', async (req, res) => {
    try {
      const input = registerSchema.parse(req.body);
      const existing = getUserByEmail(db, input.email);
      if (existing) {
        res.status(409).json({ error: 'email already registered', code: 'AUTH_EMAIL_EXISTS' });
        return;
      }

      const passwordHash = await hashPassword(input.password);
      const user = createUser(db, {
        email: input.email,
        passwordHash
      });

      const tokens = issueAuthTokens(db, user);
      res.status(201).json({
        user: { id: user.id, email: user.email, plan: user.plan },
        ...tokens
      });
    } catch (error: any) {
      res.status(error?.status || 400).json({ error: error?.message ?? 'register failed', code: error?.code });
    }
  });

  router.post('/login', async (req, res) => {
    try {
      const input = loginSchema.parse(req.body);
      const user = getUserByEmail(db, input.email);

      if (!user || !user.active) {
        res.status(401).json({ error: 'invalid credentials', code: 'AUTH_INVALID_CREDENTIALS' });
        return;
      }

      const ok = await verifyPassword(input.password, user.password_hash);
      if (!ok) {
        res.status(401).json({ error: 'invalid credentials', code: 'AUTH_INVALID_CREDENTIALS' });
        return;
      }

      const tokens = issueAuthTokens(db, user);
      res.json({
        user: { id: user.id, email: user.email, plan: user.plan },
        ...tokens
      });
    } catch (error: any) {
      res.status(error?.status || 400).json({ error: error?.message ?? 'login failed', code: error?.code });
    }
  });

  router.post('/refresh', (req, res) => {
    try {
      const input = refreshSchema.parse(req.body);
      const tokens = rotateRefreshToken(db, input.refresh_token);
      res.json(tokens);
    } catch (error: any) {
      res.status(error?.status || 400).json({ error: error?.message ?? 'refresh failed', code: error?.code });
    }
  });

  return router;
}
