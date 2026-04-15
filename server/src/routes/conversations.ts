import { Router } from 'express';
import { z } from 'zod';
import { authGuard } from '../core/auth.js';
import {
  createConversation,
  deleteConversation,
  generateConversationTitle,
  getConversation,
  getConversationMessages,
  listConversations,
  type DB
} from '../core/db.js';

const createConversationSchema = z.object({
  user_id: z.string().min(1),
  title: z.string().trim().optional(),
  first_message: z.string().trim().optional()
});

const listConversationsSchema = z.object({
  user_id: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20)
});

const conversationAccessSchema = z.object({
  user_id: z.string().min(1)
});

export function createConversationRouter({ db }: { db: DB }) {
  const router = Router();

  router.post('/', (req, res) => {
    try {
      const input = createConversationSchema.parse(req.body);
      authGuard(input.user_id);

      const conversation = createConversation(db, {
        userId: input.user_id,
        title: input.title || generateConversationTitle(input.first_message)
      });

      res.status(201).json({ conversation });
    } catch (error: any) {
      res.status(error?.status || 400).json({ error: error?.message ?? 'failed to create conversation' });
    }
  });

  router.get('/', (req, res) => {
    try {
      const input = listConversationsSchema.parse(req.query);
      authGuard(input.user_id);
      res.json(listConversations(db, {
        userId: input.user_id,
        page: input.page,
        pageSize: input.page_size
      }));
    } catch (error: any) {
      res.status(error?.status || 400).json({ error: error?.message ?? 'failed to list conversations' });
    }
  });

  router.get('/:id/messages', (req, res) => {
    try {
      const access = conversationAccessSchema.parse(req.query);
      authGuard(access.user_id);

      const conversation = getConversation(db, {
        conversationId: req.params.id,
        userId: access.user_id
      });

      if (!conversation) {
        res.status(404).json({ error: 'conversation not found' });
        return;
      }

      res.json({
        conversation,
        items: getConversationMessages(db, {
          conversationId: req.params.id,
          userId: access.user_id
        })
      });
    } catch (error: any) {
      res.status(error?.status || 400).json({ error: error?.message ?? 'failed to load messages' });
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      const access = conversationAccessSchema.parse({
        user_id: req.body?.user_id ?? req.query?.user_id
      });
      authGuard(access.user_id);

      const deleted = deleteConversation(db, {
        conversationId: req.params.id,
        userId: access.user_id
      });

      if (!deleted) {
        res.status(404).json({ error: 'conversation not found' });
        return;
      }

      res.status(204).send();
    } catch (error: any) {
      res.status(error?.status || 400).json({ error: error?.message ?? 'failed to delete conversation' });
    }
  });

  return router;
}
