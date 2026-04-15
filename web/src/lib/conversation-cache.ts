import type { CachedConversationRecord } from '@/types';

interface CacheOptions {
  dbName?: string;
  maxEntries?: number;
}

interface CacheApi {
  put: (record: Omit<CachedConversationRecord, 'lastViewedAt'> & { lastViewedAt?: number }) => Promise<void>;
  get: (conversationId: string) => Promise<CachedConversationRecord | null>;
  list: () => Promise<CachedConversationRecord[]>;
  delete: (conversationId: string) => Promise<void>;
  clear: () => Promise<void>;
}

const STORE_NAME = 'conversations';

export function createConversationCache(options: CacheOptions = {}): CacheApi {
  const dbName = options.dbName ?? 'llm-chat-conversations';
  const maxEntries = options.maxEntries ?? 50;
  let tick = 0;

  const nextTimestamp = () => Date.now() * 1000 + tick++;

  async function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'conversation.id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    });
  }

  async function withStore<T>(mode: IDBTransactionMode, handler: (store: IDBObjectStore) => Promise<T> | T): Promise<T> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const result = await handler(store);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
      });
      return result;
    } finally {
      db.close();
    }
  }

  function readRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
  }

  async function listInternal(): Promise<CachedConversationRecord[]> {
    return withStore('readonly', async (store) => {
      const all = (await readRequest(store.getAll())) as CachedConversationRecord[];
      return all.sort((a, b) => b.lastViewedAt - a.lastViewedAt);
    });
  }

  async function enforceLruLimit() {
    const all = await listInternal();
    const overflow = all.slice(maxEntries);
    if (overflow.length === 0) return;

    await withStore('readwrite', async (store) => {
      await Promise.all(overflow.map((entry) => readRequest(store.delete(entry.conversation.id))));
    });
  }

  return {
    async put(record) {
      const normalized: CachedConversationRecord = {
        ...record,
        contentText: record.contentText ?? record.messages.map((message) => message.content).join(' ').trim(),
        lastViewedAt: record.lastViewedAt ?? nextTimestamp()
      };

      await withStore('readwrite', async (store) => {
        await readRequest(store.put(normalized));
      });
      await enforceLruLimit();
    },

    async get(conversationId) {
      const existing = await withStore('readonly', async (store) => {
        return (await readRequest(store.get(conversationId))) as CachedConversationRecord | undefined;
      });

      if (!existing) {
        return null;
      }

      const touched: CachedConversationRecord = {
        ...existing,
        lastViewedAt: nextTimestamp()
      };
      await withStore('readwrite', async (store) => {
        await readRequest(store.put(touched));
      });
      return touched;
    },

    async list() {
      return listInternal();
    },

    async delete(conversationId) {
      await withStore('readwrite', async (store) => {
        await readRequest(store.delete(conversationId));
      });
    },

    async clear() {
      await withStore('readwrite', async (store) => {
        await readRequest(store.clear());
      });
    }
  };
}
