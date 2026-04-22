export interface RetryOptions<T> {
  maxRetries: number;
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  jitterRatio?: number;
  shouldRetry: (error: unknown, attempt: number) => boolean;
  onRetry?: (args: { attempt: number; nextDelayMs: number; error: unknown }) => void;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  circuitKey?: string;
}

interface CircuitState {
  consecutiveFailures: number;
  openUntil: number;
}

const circuitStore = new Map<string, CircuitState>();
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

function getState(key: string): CircuitState {
  const existing = circuitStore.get(key);
  if (existing) {
    return existing;
  }

  const created: CircuitState = {
    consecutiveFailures: 0,
    openUntil: 0
  };
  circuitStore.set(key, created);
  return created;
}

function defaultWait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function getBackoffDelayMs(params: {
  attempt: number;
  initialDelayMs: number;
  backoffFactor: number;
  maxDelayMs: number;
  jitterRatio?: number;
}) {
  const { attempt, initialDelayMs, backoffFactor, maxDelayMs, jitterRatio = 0.25 } = params;
  const baseDelay = Math.min(initialDelayMs * backoffFactor ** Math.max(0, attempt - 1), maxDelayMs);
  const jitterWindow = baseDelay * jitterRatio;
  const jitter = (Math.random() * 2 - 1) * jitterWindow;
  return Math.max(0, Math.round(baseDelay + jitter));
}

export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions<T>): Promise<T> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? defaultWait;

  if (options.circuitKey) {
    const state = getState(options.circuitKey);
    if (state.openUntil > now()) {
      const error = new Error('Circuit breaker open') as Error & { code?: string; status?: number };
      error.code = 'CIRCUIT_BREAKER_OPEN';
      error.status = 503;
      throw error;
    }
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxRetries + 1; attempt += 1) {
    try {
      const result = await fn();
      if (options.circuitKey) {
        const state = getState(options.circuitKey);
        state.consecutiveFailures = 0;
        state.openUntil = 0;
      }
      return result;
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt <= options.maxRetries && options.shouldRetry(error, attempt);
      if (!shouldRetry) {
        break;
      }

      const nextDelayMs = getBackoffDelayMs({
        attempt,
        initialDelayMs: options.initialDelayMs,
        backoffFactor: options.backoffFactor,
        maxDelayMs: options.maxDelayMs,
        jitterRatio: options.jitterRatio
      });

      options.onRetry?.({ attempt, nextDelayMs, error });
      await wait(nextDelayMs);
    }
  }

  if (options.circuitKey) {
    const state = getState(options.circuitKey);
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
      state.openUntil = now() + CIRCUIT_BREAKER_COOLDOWN_MS;
    }
  }

  throw lastError;
}

export function __resetCircuitBreakerForTests() {
  circuitStore.clear();
}
