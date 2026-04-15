import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDb, createConversation, appendMessages, getConversationMessages, listConversations, deleteConversation } from './db.js';

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-chat-db-'));
  return {
    dir,
    dbPath: path.join(dir, 'test.sqlite')
  };
}

afterEach(() => {
  // cleanup handled per test via rmSync on temp dirs
});

describe('core/db', () => {
  it('creates schema and supports CRUD for conversations and messages', () => {
    const { dir, dbPath } = makeTempDbPath();

    try {
      const db = initDb({ filename: dbPath });
      const conversation = createConversation(db, {
        userId: 'u_001',
        title: 'First chat'
      });

      appendMessages(db, conversation.id, [
        { role: 'user', content: 'Hello there', tokenCount: null },
        { role: 'assistant', content: 'Hi!', tokenCount: 12 }
      ]);

      const list = listConversations(db, { userId: 'u_001', page: 1, pageSize: 10 });
      const messages = getConversationMessages(db, { conversationId: conversation.id, userId: 'u_001' });

      expect(list.total).toBe(1);
      expect(list.items[0]).toMatchObject({
        id: conversation.id,
        user_id: 'u_001',
        title: 'First chat',
        message_count: 2
      });
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({ role: 'user', content: 'Hello there', token_count: null });
      expect(messages[1]).toMatchObject({ role: 'assistant', content: 'Hi!', token_count: 12 });

      deleteConversation(db, { conversationId: conversation.id, userId: 'u_001' });
      expect(listConversations(db, { userId: 'u_001', page: 1, pageSize: 10 }).total).toBe(0);

      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
