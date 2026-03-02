import { Router } from 'express';
import { z } from 'zod';
import { authGuard } from '../core/auth.js';
import { chooseModel } from '../core/router.js';
import { buildMessages, TOOL_DEFINITIONS } from '../core/prompt.js';
import { chatStream, toProviderMessages } from '../core/provider.js';
import { initSSE, sendSSE } from '../core/sse.js';
import { logChat } from '../core/logger.js';
import { consumeBalance } from '../mock/db.js';

const chatStreamSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant', 'tool']),
      content: z.string(),
      name: z.string().optional(),
      tool_call_id: z.string().optional()
    })
  ),
  model: z.string().default('auto'),
  mode: z.literal('stream'),
  session_id: z.string(),
  user_id: z.string(),
  trace_id: z.string(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional()
});

export const chatStreamRouter = Router();

chatStreamRouter.post('/', async (req, res) => {
  const begin = Date.now();
  let input: z.infer<typeof chatStreamSchema> | null = null;
  try {
    input = chatStreamSchema.parse(req.body);
    authGuard(input.user_id);

    const needTools = input.messages.some((m) => /time|时间/i.test(m.content));
    const selectedModel = chooseModel({
      requestedModel: input.model,
      messages: input.messages,
      needTools
    });

    initSSE(res);
    sendSSE(res, 'meta', {
      type: 'meta',
      trace_id: input.trace_id,
      session_id: input.session_id,
      model: selectedModel
    });

    const stream = await chatStream({
      model: selectedModel,
      messages: toProviderMessages(buildMessages(input.messages)),
      tools: needTools ? TOOL_DEFINITIONS : undefined,
      temperature: input.temperature,
      max_tokens: input.max_tokens
    });

    let fullText = '';
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } = {};

    req.on('close', () => {
      try {
        stream.controller.abort();
      } catch {
        // noop
      }
    });

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content ?? '';
      if (delta) {
        fullText += delta;
        sendSSE(res, 'message', {
          type: 'delta',
          text: delta,
          trace_id: input.trace_id
        });
      }

      if (chunk.usage) {
        usage = {
          prompt_tokens: chunk.usage.prompt_tokens,
          completion_tokens: chunk.usage.completion_tokens,
          total_tokens: chunk.usage.total_tokens
        };
      }
    }

    const latencyMs = Date.now() - begin;
    consumeBalance(input.user_id, 1);

    sendSSE(res, 'done', {
      type: 'done',
      text: fullText,
      usage,
      latency_ms: latencyMs,
      trace_id: input.trace_id
    });

    logChat({
      traceId: input.trace_id,
      userId: input.user_id,
      sessionId: input.session_id,
      model: selectedModel,
      mode: 'stream',
      latencyMs,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens
    });

    res.end();
  } catch (error: any) {
    const code = error?.code || 'CHAT_STREAM_ERROR';

    if (!res.headersSent) {
      res.status(error?.status || 400).json({ error: error?.message ?? 'stream request failed', code });
      return;
    }

    sendSSE(res, 'error', {
      type: 'error',
      code,
      message: error?.message ?? 'stream failed'
    });
    res.end();

    logChat({
      traceId: input?.trace_id ?? req.body?.trace_id ?? 'unknown',
      userId: input?.user_id ?? req.body?.user_id ?? 'unknown',
      sessionId: input?.session_id ?? req.body?.session_id ?? 'unknown',
      model: input?.model ?? req.body?.model ?? 'unknown',
      mode: 'stream',
      latencyMs: Date.now() - begin,
      errorCode: code
    });
  }
});
