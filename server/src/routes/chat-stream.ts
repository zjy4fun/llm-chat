import { Router } from 'express';
import { z } from 'zod';
import { authGuard } from '../core/auth.js';
import { applyRateLimitHeaders, consumeRateLimit } from '../core/rate-limit.js';
import {
  appendMessages,
  ensureConversation,
  generateConversationTitle,
  getConversationMessageCount,
  type DB
} from '../core/db.js';
import { buildContextWindow } from '../core/context-window.js';
import { logChat } from '../core/logger.js';
import { buildMessages } from '../core/prompt.js';
import { chatStream, toProviderMessages, type ProviderParams } from '../core/provider.js';
import { initSSE, sendSSE } from '../core/sse.js';
import { countChatMessageTokens } from '../core/token-counter.js';
import { runStreamToolLoop, shouldUseTools } from '../core/tool-loop.js';
import { chooseModel } from '../core/router.js';
import { consumeBalance } from '../mock/db.js';
import type { ChatMessage } from '../types/chat.js';
import type { ProviderStreamResult, ProviderUsage } from '../types/provider.js';

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
  conversation_id: z.string().optional(),
  user_id: z.string(),
  trace_id: z.string(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional()
});

export function createChatStreamRouter({
  db,
  provider = { chatStream: chatStream as unknown as (params: ProviderParams) => Promise<ProviderStreamResult> }
}: {
  db: DB;
  provider?: { chatStream: (params: ProviderParams) => Promise<ProviderStreamResult> };
}) {
  const chatStreamRouter = Router();

  chatStreamRouter.post('/', async (req, res) => {
    const begin = Date.now();
    let input: z.infer<typeof chatStreamSchema> | null = null;
    let activeController: ProviderStreamResult['controller'] | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    try {
      input = chatStreamSchema.parse(req.body);
      const auth = authGuard(input.user_id);
      const rateLimit = consumeRateLimit(auth);
      applyRateLimitHeaders(res, rateLimit);

      const needTools = shouldUseTools(input.messages);
      const selectedModel = chooseModel({
        requestedModel: input.model,
        messages: input.messages,
        needTools
      });

      initSSE(res);
      heartbeat = setInterval(() => {
        sendSSE(res, 'ping', {
          type: 'ping',
          ts: Date.now()
        });
      }, 15_000);
      sendSSE(res, 'meta', {
        type: 'meta',
        trace_id: input.trace_id,
        session_id: input.session_id,
        conversation_id: input.conversation_id ?? input.session_id,
        model: selectedModel
      });

      req.on('close', () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        try {
          activeController?.abort();
        } catch {
          // noop
        }
      });

      const mergedMessages = buildMessages(input.messages as ChatMessage[]);
      const contextWindow = buildContextWindow({
        model: selectedModel,
        messages: mergedMessages,
        responseTokenReserve: input.max_tokens
      });
      const result = needTools
        ? await runStreamToolLoop(provider, {
            model: selectedModel,
            messages: contextWindow.messages,
            temperature: input.temperature,
            max_tokens: input.max_tokens,
            onController: (controller) => {
              activeController = controller;
            },
            onTextDelta: (delta) => {
              sendSSE(res, 'message', {
                type: 'delta',
                text: delta,
                trace_id: input?.trace_id
              });
            },
            onToolMessage: (message) => {
              sendSSE(res, 'tool', {
                type: 'tool',
                message
              });
            }
          })
        : await (async () => {
            const stream = await provider.chatStream({
              model: selectedModel,
              messages: toProviderMessages(contextWindow.messages),
              temperature: input.temperature,
              max_tokens: input.max_tokens
            });

            activeController = stream.controller;

            let text = '';
            let usage: ProviderUsage = {};

            try {
              for await (const chunk of stream) {
                const delta = chunk.choices?.[0]?.delta?.content ?? '';
                if (delta) {
                  text += delta;
                  sendSSE(res, 'message', {
                    type: 'delta',
                    text: delta,
                    trace_id: input?.trace_id
                  });
                }

                if (chunk.usage) {
                  usage = chunk.usage;
                }
              }
            } catch (streamError: any) {
              if (text.length > 0) {
                sendSSE(res, 'error', {
                  type: 'error',
                  code: streamError?.code ?? 'STREAM_PARTIAL_RESPONSE',
                  message: streamError?.message ?? 'stream interrupted, returned partial response'
                });
              } else {
                throw streamError;
              }
            }

            return {
              text,
              usage,
              toolMessages: []
            };
          })();

      const latencyMs = Date.now() - begin;
      const conversationId = input.conversation_id ?? input.session_id;
      const firstUserMessage = input.messages.find((message) => message.role === 'user')?.content;

      ensureConversation(db, {
        conversationId,
        userId: input.user_id,
        title: generateConversationTitle(firstUserMessage)
      });

      const persistedCount = getConversationMessageCount(db, {
        conversationId,
        userId: input.user_id
      });
      const newInputMessages = input.messages.slice(persistedCount);

      appendMessages(db, conversationId, [
        ...newInputMessages.map((message) => ({
          role: message.role,
          content: message.content,
          tokenCount: countChatMessageTokens(selectedModel, message as ChatMessage)
        })),
        {
          role: 'assistant' as const,
          content: result.text,
          tokenCount: result.usage.completion_tokens ?? countChatMessageTokens(selectedModel, { role: 'assistant', content: result.text })
        }
      ]);

      consumeBalance(input.user_id, 1);

      sendSSE(res, 'done', {
        type: 'done',
        text: result.text,
        usage: result.usage,
        context_tokens_used: contextWindow.contextTokensUsed,
        tool_messages: result.toolMessages,
        latency_ms: latencyMs,
        trace_id: input.trace_id,
        conversation_id: conversationId
      });

      logChat({
        traceId: input.trace_id,
        userId: input.user_id,
        sessionId: input.session_id,
        model: selectedModel,
        mode: 'stream',
        latencyMs,
        promptTokens: result.usage.prompt_tokens ?? undefined,
        completionTokens: result.usage.completion_tokens ?? undefined,
        totalTokens: result.usage.total_tokens ?? undefined
      });

      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      res.end();
    } catch (error: any) {
      const code = error?.code || 'CHAT_STREAM_ERROR';
      if (error?.rateLimit && !res.headersSent) {
        applyRateLimitHeaders(res, error.rateLimit);
      }

      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }

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

  return chatStreamRouter;
}
