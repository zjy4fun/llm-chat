import express from 'express';
import cors from 'cors';
import { createChatRouter } from './routes/chat.js';
import { createChatStreamRouter } from './routes/chat-stream.js';
import { createConversationRouter } from './routes/conversations.js';
import { createAuthRouter } from './routes/auth.js';
import { createUsageRouter } from './routes/usage.js';
import { requireAuth } from './core/auth.js';
import { initDb, type DB } from './core/db.js';
import * as providerClient from './core/provider.js';
import type { ProviderCompletion, ProviderStreamResult } from './types/provider.js';
import type { ProviderParams } from './core/provider.js';

export interface AppDependencies {
  db?: DB;
  provider?: {
    chatNonStream: (params: ProviderParams) => Promise<ProviderCompletion>;
    chatStream: (params: ProviderParams) => Promise<ProviderStreamResult>;
  };
}

const defaultProvider = providerClient as unknown as NonNullable<AppDependencies['provider']>;

export function createApp(dependencies: AppDependencies = {}) {
  const app = express();
  const db = dependencies.db ?? initDb();
  const provider = dependencies.provider ?? defaultProvider;

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'llm-chat-server' });
  });

  app.use('/auth', createAuthRouter({ db }));
  app.use('/chat', requireAuth(db), createChatRouter({ db, provider }));
  app.use('/chat/stream', requireAuth(db), createChatStreamRouter({ db, provider }));
  app.use('/conversations', requireAuth(db), createConversationRouter({ db }));
  app.use('/usage', requireAuth(db), createUsageRouter({ db }));

  return app;
}
