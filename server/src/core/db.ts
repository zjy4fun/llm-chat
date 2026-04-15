import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatRole } from '../types/chat.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.resolve(__dirname, '../../data/llm-chat.db');

export type DB = Database.Database;

export interface ConversationRecord {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface MessageRecord {
  id: number;
  conversation_id: string;
  role: ChatRole;
  content: string;
  token_count: number | null;
  created_at: string;
}

export function initDb(options?: { filename?: string }): DB {
  const filename = options?.filename ?? process.env.LLM_CHAT_DB_PATH ?? DEFAULT_DB_PATH;
  fs.mkdirSync(path.dirname(filename), { recursive: true });

  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);
  return db;
}

export function closeDb(db: DB) {
  db.close();
}

export function migrate(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant', 'tool')),
      content TEXT NOT NULL,
      token_count INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
      ON conversations (user_id, updated_at DESC);

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
      ON messages (conversation_id, created_at ASC, id ASC);
  `);
}

export function createConversation(
  db: DB,
  params: { id?: string; userId: string; title: string }
): ConversationRecord {
  const conversationId = params.id ?? crypto.randomUUID();
  const normalizedTitle = normalizeTitle(params.title);

  db.prepare(
    `INSERT INTO conversations (id, user_id, title)
     VALUES (@id, @user_id, @title)`
  ).run({
    id: conversationId,
    user_id: params.userId,
    title: normalizedTitle
  });

  return getConversation(db, { conversationId, userId: params.userId })!;
}

export function getConversation(
  db: DB,
  params: { conversationId: string; userId: string }
): ConversationRecord | null {
  return (
    db
      .prepare(
        `SELECT c.id, c.user_id, c.title, c.created_at, c.updated_at,
                COUNT(m.id) as message_count
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.id = ? AND c.user_id = ?
         GROUP BY c.id`
      )
      .get(params.conversationId, params.userId) as ConversationRecord | undefined
  ) ?? null;
}

export function ensureConversation(
  db: DB,
  params: { conversationId: string; userId: string; title: string }
): ConversationRecord {
  const existing = getConversation(db, { conversationId: params.conversationId, userId: params.userId });
  if (existing) {
    return existing;
  }

  return createConversation(db, {
    id: params.conversationId,
    userId: params.userId,
    title: params.title
  });
}

export function updateConversationTitle(
  db: DB,
  params: { conversationId: string; userId: string; title: string }
) {
  db.prepare(
    `UPDATE conversations
     SET title = @title,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = @conversation_id AND user_id = @user_id`
  ).run({
    conversation_id: params.conversationId,
    user_id: params.userId,
    title: normalizeTitle(params.title)
  });
}

export function appendMessages(
  db: DB,
  conversationId: string,
  messages: Array<{ role: ChatRole; content: string; tokenCount: number | null }>
) {
  if (messages.length === 0) return;

  const insert = db.prepare(
    `INSERT INTO messages (conversation_id, role, content, token_count)
     VALUES (@conversation_id, @role, @content, @token_count)`
  );
  const touch = db.prepare(
    `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  );

  const tx = db.transaction((rows: typeof messages) => {
    for (const row of rows) {
      insert.run({
        conversation_id: conversationId,
        role: row.role,
        content: row.content,
        token_count: row.tokenCount
      });
    }
    touch.run(conversationId);
  });

  tx(messages);
}

export function getConversationMessages(
  db: DB,
  params: { conversationId: string; userId: string }
): MessageRecord[] {
  const conversation = getConversation(db, params);
  if (!conversation) {
    return [];
  }

  return db
    .prepare(
      `SELECT id, conversation_id, role, content, token_count, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(params.conversationId) as MessageRecord[];
}

export function getConversationMessageCount(
  db: DB,
  params: { conversationId: string; userId: string }
): number {
  const conversation = getConversation(db, params);
  return conversation?.message_count ?? 0;
}

export function listConversations(
  db: DB,
  params: { userId: string; page: number; pageSize: number }
): { items: ConversationRecord[]; total: number; page: number; page_size: number } {
  const offset = (params.page - 1) * params.pageSize;
  const items = db
    .prepare(
      `SELECT c.id, c.user_id, c.title, c.created_at, c.updated_at,
              COUNT(m.id) as message_count
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id
       WHERE c.user_id = ?
       GROUP BY c.id
       ORDER BY c.updated_at DESC, c.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(params.userId, params.pageSize, offset) as ConversationRecord[];

  const row = db
    .prepare(`SELECT COUNT(*) as total FROM conversations WHERE user_id = ?`)
    .get(params.userId) as { total: number };

  return {
    items,
    total: row.total,
    page: params.page,
    page_size: params.pageSize
  };
}

export function deleteConversation(
  db: DB,
  params: { conversationId: string; userId: string }
): boolean {
  const result = db
    .prepare(`DELETE FROM conversations WHERE id = ? AND user_id = ?`)
    .run(params.conversationId, params.userId);

  return result.changes > 0;
}

export function generateConversationTitle(firstUserMessage?: string | null): string {
  const normalized = normalizeTitle(firstUserMessage ?? '');
  return normalized || 'New conversation';
}

function normalizeTitle(input: string): string {
  const collapsed = input.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 80) {
    return collapsed;
  }
  return `${collapsed.slice(0, 77).trimEnd()}...`;
}
