import { describe, expect, it } from 'vitest';
import type { AuthContext } from '../types/chat.js';
import { createRateLimitStore, type RateLimitStore } from './rate-limit.js';

function consume(store: RateLimitStore, auth: AuthContext, now = Date.now()) {
  return store.consume({
    key: auth.userId,
    limit: auth.plan === 'pro' ? 60 : 20,
    windowMs: 60_000,
    now
  });
}

describe('rate limit store', () => {
  it('uses the in-memory store by default', () => {
    const store = createRateLimitStore();
    const status = consume(store, { userId: 'u_002', plan: 'free', balance: 3 }, 1_000);

    expect(status.limit).toBe(20);
    expect(status.remaining).toBe(19);
  });

  it('requires a redis url when redis mode is requested', () => {
    expect(() => createRateLimitStore({ mode: 'redis' })).toThrow(/REDIS_URL/i);
  });

  it('exposes a redis skeleton that clearly reports the missing implementation', () => {
    const store = createRateLimitStore({ mode: 'redis', redisUrl: 'redis://localhost:6379' });

    expect(() =>
      consume(store, { userId: 'u_001', plan: 'pro', balance: 999 }, 1_000)
    ).toThrow(/not implemented yet/i);
  });
});
