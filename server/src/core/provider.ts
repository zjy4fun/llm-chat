import OpenAI from 'openai';
import { retryWithBackoff } from './retry.js';
import type { ChatMessage } from '../types/chat.js';

export interface ProviderParams {
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  temperature?: number;
  max_tokens?: number;
}

const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 500,
  backoffFactor: 2,
  maxDelayMs: 5_000
} as const;

const MODEL_FALLBACKS: Record<string, string[]> = {
  'gpt-4.1': ['gpt-4o-mini', 'gpt-3.5-turbo'],
  'gpt-4.1-mini': ['gpt-4o-mini', 'gpt-3.5-turbo'],
  'gpt-4o-mini': ['gpt-3.5-turbo']
};

let client: OpenAI | null = null;

function getClient() {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1'
    });
  }
  return client;
}

function getErrorStatusCode(error: unknown): number | null {
  const status = (error as { status?: number } | null)?.status;
  return typeof status === 'number' ? status : null;
}

function isTimeoutOrNetworkError(error: unknown) {
  const err = error as { code?: string; message?: string; name?: string } | null;
  const code = err?.code?.toLowerCase() ?? '';
  const name = err?.name?.toLowerCase() ?? '';
  const message = err?.message?.toLowerCase() ?? '';

  return [code, name, message].some((value) =>
    /timeout|timed out|econnreset|econnrefused|enotfound|eai_again|network|connection/i.test(value)
  );
}

function shouldRetryProviderError(error: unknown) {
  const status = getErrorStatusCode(error);
  if (status === 429 || status === 500 || status === 502 || status === 503) {
    return true;
  }

  if (status === 400 || status === 401 || status === 404) {
    return false;
  }

  return isTimeoutOrNetworkError(error);
}

function getModelChain(model: string) {
  return [model, ...(MODEL_FALLBACKS[model] ?? [])];
}

function logRetryAttempt(args: { model: string; attempt: number; nextDelayMs: number; error: unknown }) {
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      type: 'provider_retry',
      model: args.model,
      attempt: args.attempt,
      delay_ms: args.nextDelayMs,
      error: (args.error as { message?: string; code?: string; status?: number } | null)?.message ?? String(args.error),
      code: (args.error as { code?: string } | null)?.code,
      status: (args.error as { status?: number } | null)?.status
    })
  );
}

async function withRetryAndFallback<T>(params: ProviderParams, operation: (resolvedModel: string) => Promise<T>) {
  const chain = getModelChain(params.model);
  let lastError: unknown;

  for (const resolvedModel of chain) {
    try {
      return await retryWithBackoff(() => operation(resolvedModel), {
        ...RETRY_CONFIG,
        shouldRetry: (error) => shouldRetryProviderError(error),
        onRetry: ({ attempt, nextDelayMs, error }) => {
          logRetryAttempt({
            model: resolvedModel,
            attempt,
            nextDelayMs,
            error
          });
        },
        circuitKey: `provider:${resolvedModel}`
      });
    } catch (error) {
      lastError = error;
      const canTryFallback = resolvedModel !== chain[chain.length - 1];
      if (!canTryFallback) {
        break;
      }

      console.warn(
        JSON.stringify({
          ts: new Date().toISOString(),
          type: 'provider_fallback',
          from_model: resolvedModel,
          to_model: chain[chain.indexOf(resolvedModel) + 1],
          reason: (error as { message?: string } | null)?.message ?? 'unknown error'
        })
      );
    }
  }

  throw lastError;
}

export async function chatNonStream(params: ProviderParams) {
  return withRetryAndFallback(params, (model) =>
    getClient().chat.completions.create({
      model,
      messages: params.messages,
      tools: params.tools,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 512,
      stream: false
    })
  );
}

export async function chatStream(params: ProviderParams) {
  return withRetryAndFallback(params, (model) =>
    getClient().chat.completions.create({
      model,
      messages: params.messages,
      tools: params.tools,
      temperature: params.temperature ?? 0.7,
      max_tokens: params.max_tokens ?? 512,
      stream: true,
      stream_options: { include_usage: true }
    })
  );
}

export function toProviderMessages(messages: ChatMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.content,
        tool_call_id: m.tool_call_id || 'tool_call_mock'
      };
    }
    if (m.role === 'assistant') {
      if (m.tool_calls?.length) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.tool_calls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments
            }
          }))
        };
      }
      return { role: 'assistant', content: m.content };
    }
    if (m.role === 'system') {
      return { role: 'system', content: m.content };
    }
    return { role: 'user', content: m.content };
  });
}
