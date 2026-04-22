import type { Response } from 'express';
import type { AuthContext } from '../types/chat.js';

const WINDOW_MS = 60_000;
const PLAN_LIMITS: Record<AuthContext['plan'], number> = {
  free: 20,
  pro: 60
};

export interface RateLimitStatus {
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export interface RateLimitConsumeParams {
  key: string;
  limit: number;
  windowMs: number;
  now: number;
}

export interface RateLimitStore {
  consume(params: RateLimitConsumeParams): RateLimitStatus;
  reset?(): void;
}

class InMemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, { timestamps: number[] }>();

  consume(params: RateLimitConsumeParams): RateLimitStatus {
    const bucket = this.buckets.get(params.key) ?? { timestamps: [] };
    const floor = params.now - params.windowMs;
    bucket.timestamps = bucket.timestamps.filter((timestamp) => timestamp > floor);

    if (bucket.timestamps.length >= params.limit) {
      this.buckets.set(params.key, bucket);
      return toStatus(params.limit, bucket.timestamps, params.windowMs, params.now, true);
    }

    bucket.timestamps.push(params.now);
    bucket.timestamps.sort((left, right) => left - right);
    this.buckets.set(params.key, bucket);
    return toStatus(params.limit, bucket.timestamps, params.windowMs, params.now, false);
  }

  reset() {
    this.buckets.clear();
  }
}

class RedisRateLimitStore implements RateLimitStore {
  constructor(readonly redisUrl: string) {}

  consume(_params: RateLimitConsumeParams): RateLimitStatus {
    throw new Error(
      `Redis-backed rate limiting is not implemented yet. Wire this store to ${this.redisUrl} with a shared counter script.`
    );
  }
}

function toStatus(
  limit: number,
  timestamps: number[],
  windowMs: number,
  now: number,
  exceeded: boolean
): RateLimitStatus {
  const remaining = Math.max(limit - timestamps.length, 0);
  const resetAt = timestamps.length > 0 ? timestamps[0] + windowMs : now + windowMs;
  const retryAfterSeconds = exceeded ? Math.max(Math.ceil((resetAt - now) / 1000), 1) : 0;

  return {
    limit,
    remaining,
    resetAt,
    retryAfterSeconds
  };
}

export function createRateLimitStore(options: {
  mode?: 'memory' | 'redis';
  redisUrl?: string;
} = {}): RateLimitStore {
  const mode = options.mode ?? 'memory';

  if (mode === 'redis') {
    if (!options.redisUrl) {
      throw new Error('REDIS_URL is required when RATE_LIMIT_STORE=redis');
    }

    return new RedisRateLimitStore(options.redisUrl);
  }

  return new InMemoryRateLimitStore();
}

const defaultStore = createRateLimitStore({
  mode: process.env.RATE_LIMIT_STORE === 'redis' ? 'redis' : 'memory',
  redisUrl: process.env.REDIS_URL
});

export function consumeRateLimit(auth: AuthContext, now = Date.now()): RateLimitStatus {
  const limit = PLAN_LIMITS[auth.plan] ?? PLAN_LIMITS.free;
  const status = defaultStore.consume({
    key: auth.userId,
    limit,
    windowMs: WINDOW_MS,
    now
  });

  if (status.retryAfterSeconds > 0) {
    throw Object.assign(new Error('rate limit exceeded'), {
      code: 'RATE_LIMIT_EXCEEDED',
      status: 429,
      rateLimit: status
    });
  }

  return status;
}

export function applyRateLimitHeaders(res: Response, status: RateLimitStatus) {
  res.setHeader('X-RateLimit-Limit', String(status.limit));
  res.setHeader('X-RateLimit-Remaining', String(status.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.ceil(status.resetAt / 1000)));

  if (status.retryAfterSeconds > 0) {
    res.setHeader('Retry-After', String(status.retryAfterSeconds));
  }
}

export function resetRateLimitsForTests() {
  defaultStore.reset?.();
}

// Memory mode is fine for local single-process development.
// Set RATE_LIMIT_STORE=redis and REDIS_URL=redis://... once the Redis store is implemented for shared production state.
