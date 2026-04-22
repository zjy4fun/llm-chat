import Database from 'better-sqlite3';
import crypto from 'node:crypto';
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

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  plan: 'free' | 'pro';
  active: number;
  created_at: string;
  updated_at: string;
}

const DAILY_QUOTA_BY_PLAN: Record<'free' | 'pro', number> = {
  free: 100_000,
  pro: 2_000_000
};

export function initDb(options?: { filename?: string }): DB {
  const filename = options?.filename ?? process.env.LLM_CHAT_DB_PATH ?? DEFAULT_DB_PATH;
  fs.mkdirSync(path.dirname(filename), { recursive: true });

  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);
  ensureSeedUsers(db);
  return db;
}

export function closeDb(db: DB) {
  db.close();
}

export function migrate(db: DB) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id, expires_at);

    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_usage_events_user_created ON usage_events(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

function ensureSeedUsers(db: DB) {
  const hasUsers = db.prepare('SELECT COUNT(*) as total FROM users').get() as { total: number };
  if (hasUsers.total > 0) return;

  const insert = db.prepare(`
    INSERT INTO users (id, email, password_hash, plan, active)
    VALUES (@id, @email, @password_hash, @plan, @active)
  `);

  insert.run({
    id: 'u_001',
    email: 'demo-pro@example.com',
    password_hash: '$2b$10$DLO8H4N7L8PbWf7H2S8u9uS8M4vccAW6kKf8.FjkfQjgfX5A1mV6m', // demo1234
    plan: 'pro',
    active: 1
  });

  insert.run({
    id: 'u_003',
    email: 'inactive@example.com',
    password_hash: '$2b$10$DLO8H4N7L8PbWf7H2S8u9uS8M4vccAW6kKf8.FjkfQjgfX5A1mV6m',
    plan: 'free',
    active: 0
  });
}

export function createUser(db: DB, params: { email: string; passwordHash: string; plan?: 'free' | 'pro' }): UserRecord {
  const id = `u_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan)
     VALUES (@id, @email, @password_hash, @plan)`
  ).run({
    id,
    email: params.email.toLowerCase(),
    password_hash: params.passwordHash,
    plan: params.plan ?? 'free'
  });

  return getUserById(db, id)!;
}

export function getUserByEmail(db: DB, email: string): UserRecord | null {
  return (
    db.prepare('SELECT id, email, password_hash, plan, active, created_at, updated_at FROM users WHERE email = ?').get(email.toLowerCase()) as
      | UserRecord
      | undefined
  ) ?? null;
}

export function getUserById(db: DB, userId: string): UserRecord | null {
  return (
    db.prepare('SELECT id, email, password_hash, plan, active, created_at, updated_at FROM users WHERE id = ?').get(userId) as
      | UserRecord
      | undefined
  ) ?? null;
}

export function saveRefreshToken(db: DB, params: { userId: string; tokenHash: string; expiresAt: string }) {
  db.prepare(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES (@user_id, @token_hash, @expires_at)`
  ).run({
    user_id: params.userId,
    token_hash: params.tokenHash,
    expires_at: params.expiresAt
  });
}

export function revokeRefreshToken(db: DB, tokenHash: string): boolean {
  const result = db
    .prepare(`UPDATE refresh_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL`)
    .run(tokenHash);

  return result.changes > 0;
}

export function isRefreshTokenActive(db: DB, tokenHash: string): boolean {
  const record = db
    .prepare(
      `SELECT id FROM refresh_tokens
       WHERE token_hash = ?
         AND revoked_at IS NULL
         AND datetime(expires_at) > datetime('now')`
    )
    .get(tokenHash) as { id: number } | undefined;

  return Boolean(record);
}

export function recordUsage(
  db: DB,
  params: { userId: string; model: string; promptTokens?: number | null; completionTokens?: number | null; totalTokens?: number | null }
) {
  const promptTokens = Math.max(params.promptTokens ?? 0, 0);
  const completionTokens = Math.max(params.completionTokens ?? 0, 0);
  const totalTokens = Math.max(params.totalTokens ?? promptTokens + completionTokens, 0);

  db.prepare(
    `INSERT INTO usage_events (user_id, model, prompt_tokens, completion_tokens, total_tokens)
     VALUES (@user_id, @model, @prompt_tokens, @completion_tokens, @total_tokens)`
  ).run({
    user_id: params.userId,
    model: params.model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens
  });
}

export function getUsageSummary(db: DB, userId: string) {
  const today =
    (db
      .prepare(`SELECT COALESCE(SUM(total_tokens), 0) as total FROM usage_events WHERE user_id = ? AND date(created_at) = date('now')`)
      .get(userId) as { total: number }).total ?? 0;

  const month =
    (db
      .prepare(
        `SELECT COALESCE(SUM(total_tokens), 0) as total
         FROM usage_events
         WHERE user_id = ?
           AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')`
      )
      .get(userId) as { total: number }).total ?? 0;

  const total =
    (db.prepare(`SELECT COALESCE(SUM(total_tokens), 0) as total FROM usage_events WHERE user_id = ?`).get(userId) as { total: number })
      .total ?? 0;

  const user = getUserById(db, userId);
  const dailyQuota = DAILY_QUOTA_BY_PLAN[user?.plan ?? 'free'];

  return {
    today_tokens: today,
    month_tokens: month,
    total_tokens: total,
    daily_quota: dailyQuota,
    remaining_tokens: Math.max(dailyQuota - today, 0),
    plan: user?.plan ?? 'free'
  };
}

export function assertDailyQuotaAvailable(db: DB, userId: string) {
  const usage = getUsageSummary(db, userId);
  if (usage.remaining_tokens <= 0) {
    throw Object.assign(new Error('daily token quota exhausted'), {
      code: 'QUOTA_EXHAUSTED',
      status: 402
    });
  }
  return usage;
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
