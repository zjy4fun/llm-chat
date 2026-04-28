import { describe, expect, it, vi } from 'vitest';
import { __getCircuitBreakerSizeForTests, __resetCircuitBreakerForTests, getBackoffDelayMs, retryWithBackoff } from './retry.js';

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
            shouldRetry: () => true,
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

  it('does not count non-retriable terminal errors toward opening the circuit breaker', async () => {
    __resetCircuitBreakerForTests();

    const now = vi.fn(() => 1_000);
    const nonRetriableError = Object.assign(new Error('bad request'), { status: 400 });

    for (let i = 0; i < 6; i += 1) {
      await expect(
        retryWithBackoff(
          () => Promise.reject(nonRetriableError),
          {
            maxRetries: 3,
            initialDelayMs: 1,
            backoffFactor: 2,
            maxDelayMs: 10,
            shouldRetry: () => false,
            circuitKey: 'provider:test-model',
            now
          }
        )
      ).rejects.toThrow('bad request');
    }

    await expect(
      retryWithBackoff(
        () => Promise.resolve('ok'),
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
    ).resolves.toBe('ok');
  });

  it('bounds circuit breaker entries by evicting old keys', async () => {
    __resetCircuitBreakerForTests();

    let currentTime = 1_000;
    const now = vi.fn(() => currentTime);

    for (let i = 0; i < 1_005; i += 1) {
      currentTime += 1;
      await expect(
        retryWithBackoff(
          () => Promise.reject(new Error('downstream failure')),
          {
            maxRetries: 0,
            initialDelayMs: 1,
            backoffFactor: 2,
            maxDelayMs: 10,
            shouldRetry: () => true,
            circuitKey: `provider:test-model-${i}`,
            now
          }
        )
      ).rejects.toThrow('downstream failure');
    }

    expect(__getCircuitBreakerSizeForTests()).toBeLessThanOrEqual(1_000);
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
