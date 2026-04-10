import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT) || 9000;

// ---------- Mock response lookup ----------

const MOCK_RESPONSES: Record<string, string> = {
  time: '现在是北京时间 2026年4月10日 14:30:00。有什么我可以帮你的吗？',
  hello:
    '你好！我是一个模拟的 AI 助手，正在以流式方式返回文本。有什么我可以帮助你的吗？',
  你好: '你好呀！很高兴见到你。我是 Mock LLM Server，专门用于开发测试。请随便问我点什么吧！',
  test: 'This is a **test response** from the mock LLM server.\n\n- Item 1\n- Item 2\n- Item 3\n\nEverything is working correctly! 🎉',
  code: '好的，下面是一个简单的 TypeScript 示例：\n\n```typescript\nfunction greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet("World"));\n```\n\n这个函数接收一个字符串参数并返回问候语。',
  long: '这是一段较长的模拟回复，用于测试长文本的流式输出效果。\n\n在软件开发过程中，我们经常需要模拟各种外部服务的行为，以便在不依赖真实服务的情况下进行开发和测试。Mock Server 就是这样一种工具，它可以模拟真实 API 的响应，让开发者能够专注于业务逻辑的实现。\n\n使用 Mock Server 的好处包括：\n\n1. **降低开发成本**：不需要消耗真实的 API 调用额度\n2. **提高开发效率**：无需等待网络请求，响应速度更快\n3. **可控的测试环境**：可以模拟各种边界情况和错误场景\n4. **离线开发**：即使没有网络也能正常开发\n\n希望这个 Mock Server 能帮助你更高效地进行开发！',
};

const DEFAULT_RESPONSE =
  '我是 Mock LLM Server 的模拟回复。你可以尝试发送包含以下关键词的消息来获取不同的回复：hello、你好、test、code、long、time。';

function pickResponse(messages: Array<{ role: string; content: string }>): string {
  const last = messages.filter((m) => m.role === 'user').pop();
  if (!last) return DEFAULT_RESPONSE;
  const content = last.content.toLowerCase();
  for (const [keyword, response] of Object.entries(MOCK_RESPONSES)) {
    if (content.includes(keyword)) return response;
  }
  return DEFAULT_RESPONSE;
}

// ---------- Helpers ----------

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
          end++;
          break;
        }
        end++;
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
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ---------- Request handler ----------

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  const url = req.url ?? '';

  // GET /health
  if (req.method === 'GET' && url === '/health') {
    jsonResponse(res, 200, { status: 'ok', mock: true });
    return;
  }

  // GET /v1/models
  if (req.method === 'GET' && url === '/v1/models') {
    jsonResponse(res, 200, {
      object: 'list',
      data: [
        { id: 'gpt-4o-mini', object: 'model', created: 1700000000, owned_by: 'mock' },
        { id: 'gpt-4.1-mini', object: 'model', created: 1700000000, owned_by: 'mock' },
        { id: 'gpt-4.1', object: 'model', created: 1700000000, owned_by: 'mock' },
      ],
    });
    return;
  }

  // POST /v1/chat/completions
  if (req.method === 'POST' && url === '/v1/chat/completions') {
    const raw = await readBody(req);
    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      jsonResponse(res, 400, { error: 'invalid JSON' });
      return;
    }

    const { model = 'mock-model', messages = [], stream = false, stream_options } = body;
    const responseText = pickResponse(messages);
    const id = chatcmplId();
    const created = Math.floor(Date.now() / 1000);

    // ---- Non-streaming ----
    if (!stream) {
      jsonResponse(res, 200, {
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: responseText },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 20,
          completion_tokens: responseText.length,
          total_tokens: 20 + responseText.length,
        },
      });
      return;
    }

    // ---- Streaming ----
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    req.socket.setNoDelay(true);

    let aborted = false;
    req.on('close', () => {
      aborted = true;
    });

    const write = (data: string) => {
      if (!aborted) res.write(data);
    };

    // Role chunk
    write(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        created,
        model,
        choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
      })}\n\n`
    );

    // Content chunks
    const chunks = splitIntoChunks(responseText);
    let completionTokens = 0;

    for (const chunk of chunks) {
      if (aborted) return;
      await sleep(30 + Math.random() * 40);
      completionTokens++;
      write(
        `data: ${JSON.stringify({
          id,
          object: 'chat.completion.chunk',
          created,
          model,
          choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }],
        })}\n\n`
      );
    }

    // Finish chunk
    const finishChunk: Record<string, unknown> = {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    };

    if (stream_options?.include_usage) {
      finishChunk.usage = {
        prompt_tokens: 20,
        completion_tokens: completionTokens,
        total_tokens: 20 + completionTokens,
      };
    }

    write(`data: ${JSON.stringify(finishChunk)}\n\n`);
    write('data: [DONE]\n\n');
    res.end();
    return;
  }

  // 404
  jsonResponse(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`🤖 Mock LLM Server running at http://localhost:${PORT}`);
  console.log(`   POST /v1/chat/completions  (stream & non-stream)`);
  console.log(`   GET  /v1/models`);
  console.log(`\n   Set LLM_BASE_URL=http://localhost:${PORT}/v1 in your .env to use it.`);
});
