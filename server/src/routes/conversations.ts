import { Router } from 'express';
import { z } from 'zod';
import {
  createConversation,
  deleteConversation,
  generateConversationTitle,
  getConversation,
  getConversationMessages,
  listConversations,
  updateConversationTitle,
  type DB
} from '../core/db.js';

const createConversationSchema = z.object({
  title: z.string().trim().optional(),
  first_message: z.string().trim().optional()
});

const listConversationsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20)
});

const renameConversationSchema = z.object({
  title: z.string().trim().min(1)
});

export function createConversationRouter({ db }: { db: DB }) {
  const router = Router();

  router.post('/', (req, res) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) throw Object.assign(new Error('unauthorized'), { status: 401 });

      const input = createConversationSchema.parse(req.body);
      const conversation = createConversation(db, {
        userId,
        title: input.title || generateConversationTitle(input.first_message)
      });

      res.status(201).json({ conversation });
    } catch (error: any) {
      res.status(error?.status || 400).json({ error: error?.message ?? 'failed to create conversation' });
    }
  });

  router.get('/', (req, res) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) throw Object.assign(new Error('unauthorized'), { status: 401 });
      const input = listConversationsSchema.parse(req.query);
      res.json(listConversations(db, {
        userId,
        page: input.page,
        pageSize: input.page_size
      }));
    } catch (error: any) {
      res.status(error?.status || 400).json({ error: error?.message ?? 'failed to list conversations' });
    }
  });

  router.get('/:id/messages', (req, res) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) throw Object.assign(new Error('unauthorized'), { status: 401 });

      const conversation = getConversation(db, {
        conversationId: req.params.id,
        userId
      });

      if (!conversation) {
        res.status(404).json({ error: 'conversation not found' });
        return;
      }

      res.json({
        conversation,
        items: getConversationMessages(db, {
          conversationId: req.params.id,
          userId
        })
      });
    } catch (error: any) {
      res.status(error?.status || 400).json({ error: error?.message ?? 'failed to load messages' });
    }
  });

  router.patch('/:id', (req, res) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) throw Object.assign(new Error('unauthorized'), { status: 401 });
      const input = renameConversationSchema.parse(req.body);

      const conversation = getConversation(db, {
        conversationId: req.params.id,
        userId
      });
      if (!conversation) {
        res.status(404).json({ error: 'conversation not found' });
        return;
      }

      updateConversationTitle(db, {
        conversationId: req.params.id,
        userId,
        title: input.title
      });

      res.json({
        conversation: getConversation(db, {
          conversationId: req.params.id,
          userId
        })
      });
    } catch (error: any) {
      res.status(error?.status || 400).json({ error: error?.message ?? 'failed to rename conversation' });
    }
  });

  router.delete('/:id', (req, res) => {
    try {
      const userId = req.auth?.userId;
      if (!userId) throw Object.assign(new Error('unauthorized'), { status: 401 });

      const deleted = deleteConversation(db, {
        conversationId: req.params.id,
        userId
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
