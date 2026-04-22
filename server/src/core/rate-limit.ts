import type { Response } from 'express';
import type { AuthContext } from '../types/chat.js';

const WINDOW_MS = 60_000;
const PLAN_LIMITS: Record<AuthContext['plan'], number> = {
  free: 20,
  pro: 60
};

type Bucket = {
  timestamps: number[];
};

export interface RateLimitStatus {
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

const buckets = new Map<string, Bucket>();

function getBucket(userId: string): Bucket {
  const bucket = buckets.get(userId);
  if (bucket) {
    return bucket;
  }

  const created = { timestamps: [] };
  buckets.set(userId, created);
  return created;
}

function prune(now: number, timestamps: number[]): number[] {
  const floor = now - WINDOW_MS;
  return timestamps.filter((timestamp) => timestamp > floor);
}

function toStatus(limit: number, timestamps: number[], now: number): RateLimitStatus {
  const remaining = Math.max(limit - timestamps.length, 0);
  const resetAt = timestamps.length > 0 ? timestamps[0] + WINDOW_MS : now + WINDOW_MS;
  const retryAfterSeconds = remaining > 0 ? 0 : Math.max(Math.ceil((resetAt - now) / 1000), 1);

  return {
    limit,
    remaining,
    resetAt,
    retryAfterSeconds
  };
}

export function consumeRateLimit(auth: AuthContext, now = Date.now()): RateLimitStatus {
  const limit = PLAN_LIMITS[auth.plan] ?? PLAN_LIMITS.free;
  const bucket = getBucket(auth.userId);
  bucket.timestamps = prune(now, bucket.timestamps);

  if (bucket.timestamps.length >= limit) {
    const status = toStatus(limit, bucket.timestamps, now);
    throw Object.assign(new Error('rate limit exceeded'), {
      code: 'RATE_LIMIT_EXCEEDED',
      status: 429,
      rateLimit: status
    });
  }

  bucket.timestamps.push(now);
  bucket.timestamps.sort((left, right) => left - right);
  const status = toStatus(limit, bucket.timestamps, now);

  if (bucket.timestamps.length === 0) {
    buckets.delete(auth.userId);
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
  buckets.clear();
}

// In-memory rate limiting is intentionally simple for single-process development.
// For production or horizontal scaling, move this shared state into Redis.
