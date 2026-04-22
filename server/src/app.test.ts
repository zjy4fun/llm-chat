import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { initDb, closeDb, getConversationMessages, getUserById, type DB } from './core/db.js';
import { resetRateLimitsForTests } from './core/rate-limit.js';
import { issueAuthTokens } from './core/auth.js';
import type { ChatMessage } from './types/chat.js';
import type { ProviderCompletion, ProviderStreamResult } from './types/provider.js';
import type { ProviderParams } from './core/provider.js';

function setupTestApp(overrides?: {
  provider?: {
    chatNonStream?: (params: ProviderParams) => Promise<ProviderCompletion>;
    chatStream?: (params: ProviderParams) => Promise<ProviderStreamResult>;
  };
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-chat-app-'));
  const dbPath = path.join(dir, 'app.sqlite');
  const db = initDb({ filename: dbPath });

  const defaultProvider = {
    async chatNonStream() {
      return {
        choices: [{ message: { content: 'Persisted reply' } }],
        usage: {
          prompt_tokens: 11,
          completion_tokens: 7,
          total_tokens: 18
        }
      };
    },
    async chatStream() {
      async function* chunks() {
        yield { choices: [{ delta: { content: 'Persisted ' } }] };
        yield {
          choices: [{ delta: { content: 'stream' } }],
          usage: {
            prompt_tokens: 9,
            completion_tokens: 6,
            total_tokens: 15
          }
        };
      }

      return {
        controller: { abort() {} },
        [Symbol.asyncIterator]: chunks
      } as AsyncIterable<any> & { controller: { abort(): void } };
    }
  };

  const app = createApp({
    db,
    provider: {
      chatNonStream: overrides?.provider?.chatNonStream ?? defaultProvider.chatNonStream,
      chatStream: overrides?.provider?.chatStream ?? defaultProvider.chatStream
    }
  });

  return { app, db, dir };
}

afterEach(() => {
  resetRateLimitsForTests();
});

function createAuthHeader(db: DB): string {
  const user = getUserById(db, 'u_001');
  if (!user) {
    throw new Error('Missing seeded user u_001 in tests');
  }

  const tokens = issueAuthTokens(db, user);
  return `Bearer ${tokens.access_token}`;
}


describe('conversation persistence routes', () => {
  it('creates, renames, lists, loads and deletes conversations', async () => {
    const { app, db, dir } = setupTestApp();

    try {
      const authHeader = createAuthHeader(db);
      const createRes = await request(app).post('/conversations').set('Authorization', authHeader).send({
                first_message: 'How do I persist chat history in sqlite?'
      });

      expect(createRes.status).toBe(201);
      expect(createRes.body.conversation.title).toBe('How do I persist chat history in sqlite?');

      const id = createRes.body.conversation.id;
      const renameRes = await request(app).patch(`/conversations/${id}`).set('Authorization', authHeader).send({
                title: 'SQLite history guide'
      });
      expect(renameRes.status).toBe(200);
      expect(renameRes.body.conversation.title).toBe('SQLite history guide');

      const listRes = await request(app).get('/conversations').set('Authorization', authHeader).query({ page: 1, page_size: 10 });
      expect(listRes.status).toBe(200);
      expect(listRes.body.items).toHaveLength(1);
      expect(listRes.body.items[0].title).toBe('SQLite history guide');

      const messagesRes = await request(app)
        .get(`/conversations/${id}/messages`)
        .set('Authorization', authHeader).query({});
      expect(messagesRes.status).toBe(200);
      expect(messagesRes.body.items).toEqual([]);

      const deleteRes = await request(app)
        .delete(`/conversations/${id}`)
        .set('Authorization', authHeader)
        .send({});
      expect(deleteRes.status).toBe(204);
    } finally {
      closeDb(db);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists streamed assistant replies after the SSE turn finishes', async () => {
    const { app, db, dir } = setupTestApp();

    try {
      const authHeader = createAuthHeader(db);
      const response = await request(app)
        .post('/chat/stream')
        .set('Authorization', authHeader)
        .set('Accept', 'text/event-stream')
        .send({
          messages: [{ role: 'user', content: 'Stream this reply please.' }],
          model: 'auto',
          mode: 'stream',
          session_id: 'stream-session',
                    trace_id: 'trace-stream'
        });

      expect(response.status).toBe(200);
      expect(response.text).toContain('event: done');
      expect(response.text).toContain('Persisted stream');

      const messagesRes = await request(app)
        .get('/conversations/stream-session/messages')
        .set('Authorization', authHeader).query({});
      expect(messagesRes.status).toBe(200);
      expect(messagesRes.body.items.map((item: any) => item.content)).toEqual([
        'Stream this reply please.',
        'Persisted stream'
      ]);
    } finally {
      closeDb(db);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists only the new turn for non-stream chat and auto-generates title from the first user message', async () => {
    const { app, db, dir } = setupTestApp();

    try {
      const authHeader = createAuthHeader(db);
      const firstTurn: ChatMessage[] = [{ role: 'user', content: 'Explain sqlite persistence strategy in one sentence.' }];
      const firstRes = await request(app).post('/chat').set('Authorization', authHeader).send({
        messages: firstTurn,
        model: 'auto',
        mode: 'non-stream',
        session_id: 'session-1',
                trace_id: 'trace-1'
      });

      expect(firstRes.status).toBe(200);
      expect(firstRes.body.conversation_id).toBe('session-1');
      expect(firstRes.body.message.content).toBe('Persisted reply');

      const listRes = await request(app).get('/conversations').set('Authorization', authHeader).query({ page: 1, page_size: 10 });
      expect(listRes.body.items).toHaveLength(1);
      expect(listRes.body.items[0]).toMatchObject({
        id: 'session-1',
        title: 'Explain sqlite persistence strategy in one sentence.',
        message_count: 2
      });

      const secondTurn: ChatMessage[] = [
        ...firstTurn,
        { role: 'assistant', content: 'Persisted reply' },
        { role: 'user', content: 'Add pagination too.' }
      ];
      const secondRes = await request(app).post('/chat').set('Authorization', authHeader).send({
        messages: secondTurn,
        model: 'auto',
        mode: 'non-stream',
        session_id: 'session-1',
                trace_id: 'trace-2'
      });

      expect(secondRes.status).toBe(200);

      const messagesRes = await request(app)
        .get('/conversations/session-1/messages')
        .set('Authorization', authHeader).query({});
      expect(messagesRes.status).toBe(200);
      expect(messagesRes.body.items.map((item: any) => item.content)).toEqual([
        'Explain sqlite persistence strategy in one sentence.',
        'Persisted reply',
        'Add pagination too.',
        'Persisted reply'
      ]);
    } finally {
      closeDb(db);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns context_tokens_used and stores token counts for persisted messages', async () => {
    const { app, db, dir } = setupTestApp();

    try {
      const authHeader = createAuthHeader(db);
      const response = await request(app).post('/chat').set('Authorization', authHeader).send({
        messages: [
          { role: 'user', content: 'First persisted message.' },
          { role: 'assistant', content: 'Earlier reply.' },
          { role: 'user', content: 'Count every token for this turn please.' }
        ],
        model: 'auto',
        mode: 'non-stream',
        session_id: 'context-session',
                trace_id: 'trace-context'
      });

      expect(response.status).toBe(200);
      expect(response.body.context_tokens_used).toEqual(expect.any(Number));
      expect(response.body.context_tokens_used).toBeGreaterThan(0);

      const persistedMessages = getConversationMessages(db, {
        conversationId: 'context-session',
        userId: 'u_001'
      });

      expect(persistedMessages).toHaveLength(4);
      expect(persistedMessages.every((message) => typeof message.token_count === 'number' && message.token_count > 0)).toBe(true);
    } finally {
      closeDb(db);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('truncates provider context with a sliding window but keeps the newest message', async () => {
    process.env.LLM_MAX_CONTEXT_TOKENS='120';
    const calls: ChatMessage[][] = [];
    const { app, db, dir } = setupTestApp({
      provider: {
        async chatNonStream(params) {
          calls.push((params.messages ?? []).map((message: any) => ({
            role: message.role,
            content: message.content
          })));

          return {
            choices: [{ message: { content: 'Trimmed reply' } }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 3,
              total_tokens: 13
            }
          };
        }
      }
    });

    try {
      const authHeader = createAuthHeader(db);
      const response = await request(app).post('/chat').set('Authorization', authHeader).send({
        messages: [
          { role: 'user', content: 'Old message '.repeat(40) },
          { role: 'assistant', content: 'Old reply '.repeat(40) },
          { role: 'user', content: 'Newest question that must survive truncation.' }
        ],
        model: 'gpt-4o-mini',
        mode: 'non-stream',
        session_id: 'trim-session',
                trace_id: 'trace-trim',
        max_tokens: 8
      });

      expect(response.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls[0][0].role).toBe('system');
      expect(calls[0].at(-1)?.content).toBe('Newest question that must survive truncation.');
      expect(calls[0].some((message) => message.content.includes('Old message'))).toBe(false);
    } finally {
      delete process.env.LLM_MAX_CONTEXT_TOKENS;
      closeDb(db);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('adds per-user rate limit headers on successful chat responses', async () => {
    const { app, db, dir } = setupTestApp();

    try {
      const authHeader = createAuthHeader(db);
      const response = await request(app).post('/chat').set('Authorization', authHeader).send({
        messages: [{ role: 'user', content: 'Check my remaining quota.' }],
        model: 'auto',
        mode: 'non-stream',
        session_id: 'rate-header-session',
                trace_id: 'trace-rate-header'
      });

      expect(response.status).toBe(200);
      expect(response.headers['x-ratelimit-limit']).toBe('60');
      expect(response.headers['x-ratelimit-remaining']).toBe('59');
      expect(Number(response.headers['x-ratelimit-reset'])).toBeGreaterThan(Math.floor(Date.now() / 1000));
    } finally {
      closeDb(db);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns 429 with retry-after and rate limit headers after a user exceeds the per-minute quota', async () => {
    const { app, db, dir } = setupTestApp();

    try {
      const authHeader = createAuthHeader(db);
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const response = await request(app).post('/chat').set('Authorization', authHeader).send({
          messages: [{ role: 'user', content: `Request ${attempt}` }],
          model: 'auto',
          mode: 'non-stream',
          session_id: `rate-limit-session-${attempt}`,
                    trace_id: `trace-rate-limit-${attempt}`
        });

        expect(response.status).toBe(200);
      }

      const blockedResponse = await request(app).post('/chat').set('Authorization', authHeader).send({
        messages: [{ role: 'user', content: 'This one should be blocked.' }],
        model: 'auto',
        mode: 'non-stream',
        session_id: 'rate-limit-blocked-session',
                trace_id: 'trace-rate-limit-blocked'
      });

      expect(blockedResponse.status).toBe(429);
      expect(blockedResponse.body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(blockedResponse.headers['retry-after']).toBeDefined();
      expect(blockedResponse.headers['x-ratelimit-limit']).toBe('60');
      expect(blockedResponse.headers['x-ratelimit-remaining']).toBe('0');
      expect(Number(blockedResponse.headers['x-ratelimit-reset'])).toBeGreaterThan(Math.floor(Date.now() / 1000));
    } finally {
      closeDb(db);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
