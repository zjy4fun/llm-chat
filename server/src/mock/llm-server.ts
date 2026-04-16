import http from 'node:http';
import { buildMockResponsePlan } from './tool-aware-response.js';

const PORT = Number(process.env.MOCK_PORT) || 9000;

function chatcmplId() {
  return 'chatcmpl-mock-' + Math.random().toString(36).slice(2, 10);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code > 0x2e80) {
      chunks.push(text.slice(i, i + 1));
      i += 1;
    } else if (text[i] === '\n') {
      chunks.push(text.slice(i, i + 1));
      i += 1;
    } else {
      let end = i + 1;
      while (end < text.length && text.charCodeAt(end) <= 0x2e80 && text[end] !== '\n') {
        if (text[i] === ' ' && text[end] !== ' ') break;
        if (text[i] !== ' ' && text[end] === ' ') {
          end += 1;
          break;
        }
        end += 1;
      }
      chunks.push(text.slice(i, end));
      i = end;
    }
  }
  return chunks;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    req.on('data', (chunk) => parts.push(chunk));
    req.on('end', () => resolve(Buffer.concat(parts).toString()));
    req.on('error', reject);
  });
}

function jsonResponse(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  const url = req.url ?? '';

  if (req.method === 'GET' && url === '/health') {
    jsonResponse(res, 200, { status: 'ok', mock: true });
    return;
  }

  if (req.method === 'GET' && url === '/v1/models') {
    jsonResponse(res, 200, {
      object: 'list',
      data: [
        { id: 'gpt-4o-mini', object: 'model', created: 1700000000, owned_by: 'mock' },
        { id: 'gpt-4.1-mini', object: 'model', created: 1700000000, owned_by: 'mock' },
        { id: 'gpt-4.1', object: 'model', created: 1700000000, owned_by: 'mock' }
      ]
    });
    return;
  }

  if (req.method === 'POST' && url === '/v1/chat/completions') {
    const raw = await readBody(req);
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      jsonResponse(res, 400, { error: 'invalid JSON' });
      return;
    }

    const { model = 'mock-model', messages = [], stream = false, stream_options, tools } = body;
    const responsePlan = buildMockResponsePlan(messages, tools);
    const id = chatcmplId();
    const created = Math.floor(Date.now() / 1000);

    if (!stream) {
      if (responsePlan.toolCall) {
        jsonResponse(res, 200, {
          id,
          object: 'chat.completion',
          created,
          model,
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: responsePlan.toolCall.id,
                    type: 'function',
                    function: {
                      name: responsePlan.toolCall.name,
                      arguments: JSON.stringify(responsePlan.toolCall.args)
                    }
                  }
                ]
              },
              finish_reason: 'tool_calls'
            }
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 5,
            total_tokens: 25
          }
        });
        return;
      }

      const responseText = responsePlan.text ?? 'Mock response unavailable.';
      jsonResponse(res, 200, {
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: responseText },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: responseText.length,
          total_tokens: 20 + responseText.length
        }
      });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no'
    });
    req.socket.setNoDelay(true);

    let aborted = false;
    req.on('close', () => {
      aborted = true;
    });

    const write = (data: string) => {
      if (!aborted) res.write(data);
    };

    if (responsePlan.toolCall) {
      await sleep(30);
      write(
        `data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: responsePlan.toolCall.id,
                    type: 'function',
                    function: {
                      name: responsePlan.toolCall.name,
                      arguments: JSON.stringify(responsePlan.toolCall.args)
                    }
                  }
                ]
              },
              finish_reason: null
            }
          ]
        })}\n\n`
      );

      const finishChunk: Record<string, unknown> = {
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }]
      };

      if (stream_options?.include_usage) {
        finishChunk.usage = { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 };
      }

      write(`data: ${JSON.stringify(finishChunk)}\n\n`);
      write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const responseText = responsePlan.text ?? 'Mock response unavailable.';
    write(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }]
      })}\n\n`
    );

    const chunks = splitIntoChunks(responseText);
    let completionTokens = 0;

    for (const chunk of chunks) {
      if (aborted) return;
      await sleep(30 + Math.random() * 40);
      completionTokens += 1;
      write(
        `data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }]
        })}\n\n`
      );
    }

    const finishChunk: Record<string, unknown> = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    };

    if (stream_options?.include_usage) {
      finishChunk.usage = {
        prompt_tokens: 20,
        completion_tokens: completionTokens,
        total_tokens: 20 + completionTokens
      };
    }

    write(`data: ${JSON.stringify(finishChunk)}\n\n`);
    write('data: [DONE]\n\n');
    res.end();
    return;
  }

  jsonResponse(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`🤖 Mock LLM Server running at http://localhost:${PORT}`);
  console.log('   POST /v1/chat/completions  (stream & non-stream)');
  console.log('   GET  /v1/models');
  console.log(`\n   Set LLM_BASE_URL=http://localhost:${PORT}/v1 in your .env to use it.`);
});
