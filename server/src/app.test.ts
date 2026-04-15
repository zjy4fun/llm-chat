import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { initDb, closeDb } from './core/db.js';
import type { ChatMessage } from './types/chat.js';

function setupTestApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-chat-app-'));
  const dbPath = path.join(dir, 'app.sqlite');
  const db = initDb({ filename: dbPath });

  const app = createApp({
    db,
    provider: {
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
    }
  });

  return { app, db, dir };
}

afterEach(() => {
  // cleanup done inside each test
});

describe('conversation persistence routes', () => {
  it('creates, lists, loads and deletes conversations', async () => {
    const { app, db, dir } = setupTestApp();

    try {
      const createRes = await request(app).post('/conversations').send({
        user_id: 'u_001',
        first_message: 'How do I persist chat history in sqlite?'
      });

      expect(createRes.status).toBe(201);
      expect(createRes.body.conversation.title).toBe('How do I persist chat history in sqlite?');

      const listRes = await request(app).get('/conversations').query({ user_id: 'u_001', page: 1, page_size: 10 });
      expect(listRes.status).toBe(200);
      expect(listRes.body.items).toHaveLength(1);

      const id = createRes.body.conversation.id;
      const messagesRes = await request(app)
        .get(`/conversations/${id}/messages`)
        .query({ user_id: 'u_001' });
      expect(messagesRes.status).toBe(200);
      expect(messagesRes.body.items).toEqual([]);

      const deleteRes = await request(app)
        .delete(`/conversations/${id}`)
        .send({ user_id: 'u_001' });
      expect(deleteRes.status).toBe(204);
    } finally {
      closeDb(db);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persists streamed assistant replies after the SSE turn finishes', async () => {
    const { app, db, dir } = setupTestApp();

    try {
      const response = await request(app)
        .post('/chat/stream')
        .set('Accept', 'text/event-stream')
        .send({
          messages: [{ role: 'user', content: 'Stream this reply please.' }],
          model: 'auto',
          mode: 'stream',
          session_id: 'stream-session',
          user_id: 'u_001',
          trace_id: 'trace-stream'
        });

      expect(response.status).toBe(200);
      expect(response.text).toContain('event: done');
      expect(response.text).toContain('Persisted stream');

      const messagesRes = await request(app)
        .get('/conversations/stream-session/messages')
        .query({ user_id: 'u_001' });
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
      const firstTurn: ChatMessage[] = [{ role: 'user', content: 'Explain sqlite persistence strategy in one sentence.' }];
      const firstRes = await request(app).post('/chat').send({
        messages: firstTurn,
        model: 'auto',
        mode: 'non-stream',
        session_id: 'session-1',
        user_id: 'u_001',
        trace_id: 'trace-1'
      });

      expect(firstRes.status).toBe(200);
      expect(firstRes.body.conversation_id).toBe('session-1');
      expect(firstRes.body.message.content).toBe('Persisted reply');

      const listRes = await request(app).get('/conversations').query({ user_id: 'u_001', page: 1, page_size: 10 });
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
      const secondRes = await request(app).post('/chat').send({
        messages: secondTurn,
        model: 'auto',
        mode: 'non-stream',
        session_id: 'session-1',
        user_id: 'u_001',
        trace_id: 'trace-2'
      });

      expect(secondRes.status).toBe(200);

      const messagesRes = await request(app)
        .get('/conversations/session-1/messages')
        .query({ user_id: 'u_001' });
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
});
