import { Router } from 'express';
import { z } from 'zod';
import { authGuard } from '../core/auth.js';
import {
  appendMessages,
  ensureConversation,
  generateConversationTitle,
  getConversationMessageCount,
  type DB
} from '../core/db.js';
import { chooseModel } from '../core/router.js';
import { buildMessages, TOOL_DEFINITIONS } from '../core/prompt.js';
import { chatNonStream, toProviderMessages, type ProviderParams } from '../core/provider.js';
import type { ProviderCompletion } from '../types/provider.js';
import { logChat } from '../core/logger.js';
import { consumeBalance } from '../mock/db.js';

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
  user_id: z.string(),
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
      authGuard(input.user_id);

      const needTools = input.messages.some((m) => /time|时间/i.test(m.content));
      const selectedModel = chooseModel({
        requestedModel: input.model,
        messages: input.messages,
        needTools
      });

      const mergedMessages = buildMessages(input.messages);
      const completion = await provider.chatNonStream({
        model: selectedModel,
        messages: toProviderMessages(mergedMessages),
        tools: needTools ? TOOL_DEFINITIONS : undefined,
        temperature: input.temperature,
        max_tokens: input.max_tokens
      });

      const usage = completion.usage;
      const text = completion.choices[0]?.message?.content ?? '';
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
          tokenCount: null
        })),
        {
          role: 'assistant' as const,
          content: text,
          tokenCount: usage?.completion_tokens ?? usage?.total_tokens ?? null
        }
      ]);

      consumeBalance(input.user_id, 1);

      logChat({
        traceId: input.trace_id,
        userId: input.user_id,
        sessionId: input.session_id,
        model: selectedModel,
        mode: 'non-stream',
        latencyMs,
        promptTokens: usage?.prompt_tokens ?? undefined,
        completionTokens: usage?.completion_tokens ?? undefined,
        totalTokens: usage?.total_tokens ?? undefined
      });

      res.json({
        trace_id: input.trace_id,
        session_id: input.session_id,
        conversation_id: conversationId,
        model: selectedModel,
        message: { role: 'assistant', content: text },
        usage: {
          prompt_tokens: usage?.prompt_tokens ?? null,
          completion_tokens: usage?.completion_tokens ?? null,
          total_tokens: usage?.total_tokens ?? null
        },
        latency_ms: latencyMs
      });
    } catch (error: any) {
      const status = error?.status || 400;
      const code = error?.code || 'CHAT_NON_STREAM_ERROR';
      logChat({
        traceId: req.body?.trace_id ?? 'unknown',
        userId: req.body?.user_id ?? 'unknown',
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
