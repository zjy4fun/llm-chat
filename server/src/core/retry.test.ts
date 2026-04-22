import { describe, expect, it, vi } from 'vitest';
import { __resetCircuitBreakerForTests, getBackoffDelayMs, retryWithBackoff } from './retry.js';

describe('retryWithBackoff', () => {
  it('retries transient errors and eventually succeeds', async () => {
    const wait = vi.fn(async () => {});
    const task = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('ok');

    const result = await retryWithBackoff(task, {
      maxRetries: 3,
      initialDelayMs: 1,
      backoffFactor: 2,
      maxDelayMs: 10,
      shouldRetry: () => true,
      wait
    });

    expect(result).toBe('ok');
    expect(task).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it('opens circuit breaker after enough consecutive failures', async () => {
    __resetCircuitBreakerForTests();

    const now = vi.fn(() => 1_000);

    for (let i = 0; i < 5; i += 1) {
      await expect(
        retryWithBackoff(
          () => Promise.reject(new Error('downstream failure')),
          {
            maxRetries: 0,
            initialDelayMs: 1,
            backoffFactor: 2,
            maxDelayMs: 10,
            shouldRetry: () => false,
            circuitKey: 'provider:test-model',
            now
          }
        )
      ).rejects.toThrow('downstream failure');
    }

    await expect(
      retryWithBackoff(
        () => Promise.resolve('never'),
        {
          maxRetries: 0,
          initialDelayMs: 1,
          backoffFactor: 2,
          maxDelayMs: 10,
          shouldRetry: () => false,
          circuitKey: 'provider:test-model',
          now
        }
      )
    ).rejects.toMatchObject({ code: 'CIRCUIT_BREAKER_OPEN' });
  });

  it('caps backoff delay at configured max delay', () => {
    const delay = getBackoffDelayMs({
      attempt: 8,
      initialDelayMs: 500,
      backoffFactor: 2,
      maxDelayMs: 5_000,
      jitterRatio: 0
    });

    expect(delay).toBe(5_000);
  });
});
