import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendNonStream } from './api';
import type { ChatRequest } from './types';

const payload: ChatRequest = {
  messages: [{ role: 'user', content: 'hello' }],
  model: 'auto',
  mode: 'non-stream',
  session_id: 'session-1',
  user_id: 'u_001',
  trace_id: 'trace-1'
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendNonStream', () => {
  it('treats missing rate limit headers as absent instead of fabricating zero quota', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: { role: 'assistant', content: 'hello back' },
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }
        )
      )
    );

    const result = await sendNonStream(payload);

    expect(result.raw.rate_limit).toBeUndefined();
  });
});
