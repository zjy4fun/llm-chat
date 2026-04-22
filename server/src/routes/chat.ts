import { Router } from 'express';
import { z } from 'zod';
import { applyRateLimitHeaders, consumeRateLimit } from '../core/rate-limit.js';
import {
  appendMessages,
  assertDailyQuotaAvailable,
  ensureConversation,
  generateConversationTitle,
  getConversationMessageCount,
  recordUsage,
  type DB
} from '../core/db.js';
import { buildContextWindow } from '../core/context-window.js';
import { logChat } from '../core/logger.js';
import { buildMessages } from '../core/prompt.js';
import { chatNonStream, toProviderMessages, type ProviderParams } from '../core/provider.js';
import { countChatMessageTokens } from '../core/token-counter.js';
import { runNonStreamToolLoop, shouldUseTools } from '../core/tool-loop.js';
import { chooseModel } from '../core/router.js';
import type { ChatMessage } from '../types/chat.js';
import type { ProviderCompletion } from '../types/provider.js';

const chatSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant', 'tool']),
      content: z.string(),
      name: z.string().optional(),
      tool_call_id: z.string().optional()
    })
  ),
  model: z.string().default('auto'),
  mode: z.literal('non-stream'),
  session_id: z.string(),
  conversation_id: z.string().optional(),
  trace_id: z.string(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional()
});

export function createChatRouter({
  db,
  provider = { chatNonStream: chatNonStream as unknown as (params: ProviderParams) => Promise<ProviderCompletion> }
}: {
  db: DB;
  provider?: { chatNonStream: (params: ProviderParams) => Promise<ProviderCompletion> };
}) {
  const chatRouter = Router();

  chatRouter.post('/', async (req, res) => {
    const begin = Date.now();
    try {
      const input = chatSchema.parse(req.body);
      const auth = req.auth;
      if (!auth) throw Object.assign(new Error('unauthorized'), { status: 401, code: 'AUTH_MISSING_TOKEN' });
      assertDailyQuotaAvailable(db, auth.userId);
      const rateLimit = consumeRateLimit(auth);
      applyRateLimitHeaders(res, rateLimit);

      const needTools = shouldUseTools(input.messages);
      const selectedModel = chooseModel({
        requestedModel: input.model,
        messages: input.messages,
        needTools
      });

      const mergedMessages = buildMessages(input.messages as ChatMessage[]);
      const contextWindow = buildContextWindow({
        model: selectedModel,
        messages: mergedMessages,
        responseTokenReserve: input.max_tokens
      });
      const result = needTools
        ? await runNonStreamToolLoop(provider, {
            model: selectedModel,
            messages: contextWindow.messages,
            temperature: input.temperature,
            max_tokens: input.max_tokens
          })
        : await (async () => {
            const completion = await provider.chatNonStream({
              model: selectedModel,
              messages: toProviderMessages(contextWindow.messages),
              temperature: input.temperature,
              max_tokens: input.max_tokens
            });

            return {
              text: completion.choices[0]?.message?.content ?? '',
              usage: completion.usage ?? {},
              toolMessages: []
            };
          })();

      const latencyMs = Date.now() - begin;
      const conversationId = input.conversation_id ?? input.session_id;
      const firstUserMessage = input.messages.find((message) => message.role === 'user')?.content;

      ensureConversation(db, {
        conversationId,
        userId: auth.userId,
        title: generateConversationTitle(firstUserMessage)
      });

      const persistedCount = getConversationMessageCount(db, {
        conversationId,
        userId: auth.userId
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
          tokenCount: result.usage?.completion_tokens ?? countChatMessageTokens(selectedModel, { role: 'assistant', content: result.text })
        }
      ]);

      recordUsage(db, {
        userId: auth.userId,
        model: selectedModel,
        promptTokens: result.usage?.prompt_tokens ?? null,
        completionTokens: result.usage?.completion_tokens ?? null,
        totalTokens: result.usage?.total_tokens ?? null
      });

      logChat({
        traceId: input.trace_id,
        userId: auth.userId,
        sessionId: input.session_id,
        model: selectedModel,
        mode: 'non-stream',
        latencyMs,
        promptTokens: result.usage?.prompt_tokens ?? undefined,
        completionTokens: result.usage?.completion_tokens ?? undefined,
        totalTokens: result.usage?.total_tokens ?? undefined
      });

      res.json({
        trace_id: input.trace_id,
        session_id: input.session_id,
        conversation_id: conversationId,
        model: selectedModel,
        tool_messages: result.toolMessages,
        context_tokens_used: contextWindow.contextTokensUsed,
        message: { role: 'assistant', content: result.text },
        usage: {
          prompt_tokens: result.usage?.prompt_tokens ?? null,
          completion_tokens: result.usage?.completion_tokens ?? null,
          total_tokens: result.usage?.total_tokens ?? null
        },
        latency_ms: latencyMs
      });
    } catch (error: any) {
      const status = error?.status || 400;
      const code = error?.code || 'CHAT_NON_STREAM_ERROR';
      if (error?.rateLimit) {
        applyRateLimitHeaders(res, error.rateLimit);
      }
      logChat({
        traceId: req.body?.trace_id ?? 'unknown',
        userId: req.auth?.userId ?? 'unknown',
        sessionId: req.body?.session_id ?? 'unknown',
        model: req.body?.model ?? 'unknown',
        mode: 'non-stream',
        latencyMs: Date.now() - begin,
        errorCode: code
      });
      res.status(status).json({ error: error?.message ?? 'request failed', code });
    }
  });

  return chatRouter;
}
