import { Router } from 'express';
import { getUsageSummary, type DB } from '../core/db.js';

export function createUsageRouter({ db }: { db: DB }) {
  const router = Router();

  router.get('/me', (req, res) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) {
        res.status(401).json({ error: 'unauthorized', code: 'AUTH_MISSING_TOKEN' });
        return;
      }

      res.json(getUsageSummary(db, userId));
    } catch (error: any) {
      res.status(error?.status || 400).json({ error: error?.message ?? 'failed to load usage', code: error?.code });
    }
  });

  return router;
}
