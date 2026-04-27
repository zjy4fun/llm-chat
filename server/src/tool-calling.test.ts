import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { closeDb, getUserById, initDb, type DB } from './core/db.js';
import type { ProviderCompletion, ProviderStreamChunk, ProviderStreamResult } from './types/provider.js';
import type { ProviderParams } from './core/provider.js';
import { issueAuthTokens } from './core/auth.js';

function createStreamResult(chunks: ProviderStreamChunk[]): ProviderStreamResult {
  async function* iterate() {
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  return {
    controller: { abort() {} },
    [Symbol.asyncIterator]: iterate
  };
}

function setupToolCallingApp(provider: {
  chatNonStream: (params: ProviderParams) => Promise<ProviderCompletion>;
  chatStream: (params: ProviderParams) => Promise<ProviderStreamResult>;
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-chat-tools-'));
  const dbPath = path.join(dir, 'app.sqlite');
  const db = initDb({ filename: dbPath });
  const app = createApp({ db, provider });

  return { app, db, dir };
}


function createAuthHeader(db: DB): string {
  const user = getUserById(db, 'u_001');
  if (!user) {
    throw new Error('Missing seeded user u_001 in tests');
  }

  const tokens = issueAuthTokens(db, user);
  return `Bearer ${tokens.access_token}`;
}

describe('tool calling loop', () => {
  it('executes tool calls in non-stream mode and feeds tool results back to the model', async () => {
    const providerCalls: ProviderParams[] = [];
    const provider = {
      async chatNonStream(params: ProviderParams): Promise<ProviderCompletion> {
        providerCalls.push(params);

        if (providerCalls.length === 1) {
          return {
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_time_1',
                      type: 'function',
                      function: {
                        name: 'get_time',
                        arguments: '{"timezone":"Asia/Shanghai"}'
                      }
                    }
                  ]
                }
              }
            ],
            usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
          };
        }

        return {
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content: 'The tool says the current time in Asia/Shanghai has been retrieved successfully.'
              }
            }
          ],
          usage: { prompt_tokens: 18, completion_tokens: 9, total_tokens: 27 }
        };
      },
      async chatStream(): Promise<ProviderStreamResult> {
        throw new Error('stream should not be called in non-stream test');
      }
    };

    const { app, db, dir } = setupToolCallingApp(provider);

    try {
      const authHeader = createAuthHeader(db);
      const response = await request(app).post('/chat').set('Authorization', authHeader).send({
        messages: [{ role: 'user', content: 'What time is it in Shanghai right now?' }],
        model: 'auto',
        mode: 'non-stream',
        session_id: 'tool-session',
                trace_id: 'trace-tools-non-stream'
      });

      expect(response.status).toBe(200);
      expect(providerCalls).toHaveLength(2);
      expect(response.body.message.content).toContain('current time in Asia/Shanghai');
      expect(response.body.tool_messages).toEqual([
        expect.objectContaining({ role: 'assistant', content: expect.stringContaining('get_time') }),
        expect.objectContaining({ role: 'tool', content: expect.stringContaining('Asia/Shanghai') })
      ]);

      expect(providerCalls[1]?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'assistant', tool_calls: expect.any(Array) }),
          expect.objectContaining({ role: 'tool', tool_call_id: 'call_time_1' })
        ])
      );
    } finally {
      closeDb(db);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('emits tool call and tool result SSE events before the final streamed answer', async () => {
    let streamCallCount = 0;
    const provider = {
      async chatNonStream(): Promise<ProviderCompletion> {
        throw new Error('non-stream should not be called in stream test');
      },
      async chatStream(): Promise<ProviderStreamResult> {
        streamCallCount += 1;

        if (streamCallCount === 1) {
          return createStreamResult([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_calc_1',
                        type: 'function',
                        function: {
                          name: 'calculate',
                          arguments: ''
                        }
                      }
                    ]
                  }
                }
              ]
            },
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: '{"expression":"2+3*4"}'
                        }
                      }
                    ]
                  }
                }
              ]
            },
            {
              choices: [{ delta: {}, finish_reason: 'tool_calls' }],
              usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 }
            }
          ]);
        }

        return createStreamResult([
          { choices: [{ delta: { content: 'The result is ' } }] },
          {
            choices: [{ delta: { content: '14.' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 15, completion_tokens: 6, total_tokens: 21 }
          }
        ]);
      }
    };

    const { app, db, dir } = setupToolCallingApp(provider);

    try {
      const authHeader = createAuthHeader(db);
      const response = await request(app)
        .post('/chat/stream')
        .set('Authorization', authHeader)
        .set('Accept', 'text/event-stream')
        .send({
          messages: [{ role: 'user', content: 'What time is it, and also calculate 2+3*4.' }],
          model: 'auto',
          mode: 'stream',
          session_id: 'tool-stream-session',
                    trace_id: 'trace-tools-stream'
        });

      expect(response.status).toBe(200);
      expect(streamCallCount).toBe(2);
      expect(response.text).toContain('event: tool');
      expect(response.text).toContain('Calling calculate');
      expect(response.text).toContain('2+3*4');
      expect(response.text).toContain('The result is 14.');
      expect(response.text).toContain('event: done');
    } finally {
      closeDb(db);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('buffers streamed text until the turn is known not to contain tool calls', async () => {
    let streamCallCount = 0;
    const provider = {
      async chatNonStream(): Promise<ProviderCompletion> {
        throw new Error('non-stream should not be called in buffered stream test');
      },
      async chatStream(): Promise<ProviderStreamResult> {
        streamCallCount += 1;

        if (streamCallCount === 1) {
          return createStreamResult([
            { choices: [{ delta: { content: 'Let me think first. ' } }] },
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_calc_buffered',
                        type: 'function',
                        function: {
                          name: 'calculate',
                          arguments: ''
                        }
                      }
                    ]
                  }
                }
              ]
            },
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: '{"expression":"2+3*4"}'
                        }
                      }
                    ]
                  }
                }
              ]
            },
            {
              choices: [{ delta: {}, finish_reason: 'tool_calls' }],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
            }
          ]);
        }

        return createStreamResult([
          { choices: [{ delta: { content: 'The buffered-safe answer is ' } }] },
          {
            choices: [{ delta: { content: '14.' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 14, completion_tokens: 4, total_tokens: 18 }
          }
        ]);
      }
    };

    const { app, db, dir } = setupToolCallingApp(provider);

    try {
      const authHeader = createAuthHeader(db);
      const response = await request(app)
        .post('/chat/stream')
        .set('Authorization', authHeader)
        .set('Accept', 'text/event-stream')
        .send({
          messages: [{ role: 'user', content: 'Calculate 2+3*4 after deciding whether you need a tool.' }],
          model: 'auto',
          mode: 'stream',
          session_id: 'tool-stream-buffered-session',
                    trace_id: 'trace-tools-stream-buffered'
        });

      expect(response.status).toBe(200);
      expect(streamCallCount).toBe(2);
      expect(response.text).not.toContain('Let me think first.');
      expect(response.text).toContain('Calling calculate');
      expect(response.text).toContain('The buffered-safe answer is 14.');
    } finally {
      closeDb(db);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips the streaming tool loop when the request does not need tools', async () => {
    const providerCalls: ProviderParams[] = [];
    const provider = {
      async chatNonStream(): Promise<ProviderCompletion> {
        throw new Error('non-stream should not be called in no-tools stream test');
      },
      async chatStream(params: ProviderParams): Promise<ProviderStreamResult> {
        providerCalls.push(params);
        return createStreamResult([
          { choices: [{ delta: { content: 'Plain ' } }] },
          {
            choices: [{ delta: { content: 'stream reply.' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 }
          }
        ]);
      }
    };

    const { app, db, dir } = setupToolCallingApp(provider);

    try {
      const authHeader = createAuthHeader(db);
      const response = await request(app)
        .post('/chat/stream')
        .set('Authorization', authHeader)
        .set('Accept', 'text/event-stream')
        .send({
          messages: [{ role: 'user', content: 'Write a short greeting with no tools.' }],
          model: 'auto',
          mode: 'stream',
          session_id: 'tool-stream-no-tools-session',
                    trace_id: 'trace-tools-stream-no-tools'
        });

      expect(response.status).toBe(200);
      expect(providerCalls).toHaveLength(1);
      expect(providerCalls[0]?.tools).toBeUndefined();
      expect(response.text).not.toContain('event: tool');
      expect(response.text).toContain('Plain stream reply.');
    } finally {
      closeDb(db);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
