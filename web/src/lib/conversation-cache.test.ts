import { beforeEach, describe, expect, it } from 'vitest';
import { createConversationCache } from './conversation-cache';

function makeConversation(id: string, title: string) {
  return {
    conversation: {
      id,
      user_id: 'u_001',
      title,
      created_at: '2026-04-15T00:00:00.000Z',
      updated_at: '2026-04-15T00:00:00.000Z',
      message_count: 1
    },
    messages: [{ role: 'user' as const, content: `message-${id}` }],
    contentText: `message-${id}`
  };
}

describe('conversation cache', () => {
  beforeEach(async () => {
    const databases = await indexedDB.databases();
    await Promise.all(databases.map((db) => (db.name ? indexedDB.deleteDatabase(db.name) : undefined)));
  });

  it('stores and reads back cached conversations', async () => {
    const cache = createConversationCache({ dbName: 'cache-read', maxEntries: 50 });
    const record = makeConversation('c-1', 'Project Alpha');

    await cache.put(record);
    const result = await cache.get('c-1');

    expect(result?.conversation.title).toBe('Project Alpha');
    expect(result?.messages[0].content).toBe('message-c-1');
  });

  it('evicts least recently viewed entries once the cache exceeds the LRU limit', async () => {
    const cache = createConversationCache({ dbName: 'cache-lru', maxEntries: 2 });

    await cache.put(makeConversation('c-1', 'One'));
    await cache.put(makeConversation('c-2', 'Two'));
    await cache.get('c-1');
    await cache.put(makeConversation('c-3', 'Three'));

    const all = await cache.list();
    expect(all.map((entry) => entry.conversation.id)).toEqual(['c-3', 'c-1']);
    expect(await cache.get('c-2')).toBeNull();
  });
});
