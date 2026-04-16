import { TOOL_DEFINITIONS } from './prompt.js';
import { executeToolCalls } from './tool-executor.js';
import { toProviderMessages, type ProviderParams } from './provider.js';
import type { ChatMessage, ChatToolCall } from '../types/chat.js';
import type { ProviderCompletion, ProviderStreamChunk, ProviderStreamResult, ProviderToolCall, ProviderUsage } from '../types/provider.js';

export const MAX_TOOL_LOOP_DEPTH = 3;

export interface ToolLoopResult {
  text: string;
  usage: ProviderUsage;
  toolMessages: ChatMessage[];
}

interface NonStreamDependencies {
  chatNonStream: (params: ProviderParams) => Promise<ProviderCompletion>;
}

interface StreamDependencies {
  chatStream: (params: ProviderParams) => Promise<ProviderStreamResult>;
}

interface LoopParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

function addUsage(total: ProviderUsage, next?: ProviderUsage | null): ProviderUsage {
  if (!next) {
    return total;
  }

  return {
    prompt_tokens: (total.prompt_tokens ?? 0) + (next.prompt_tokens ?? 0),
    completion_tokens: (total.completion_tokens ?? 0) + (next.completion_tokens ?? 0),
    total_tokens: (total.total_tokens ?? 0) + (next.total_tokens ?? 0)
  };
}

function toolLoopLimitError() {
  const error = new Error(`Tool loop exceeded max depth of ${MAX_TOOL_LOOP_DEPTH}`) as Error & {
    status?: number;
    code?: string;
  };
  error.status = 400;
  error.code = 'TOOL_LOOP_LIMIT';
  return error;
}

function normalizeToolCall(toolCall: ProviderToolCall | ChatToolCall, index: number): ChatToolCall {
  return {
    id: toolCall.id || `tool_call_${index}`,
    type: 'function',
    function: {
      name: toolCall.function?.name || 'unknown_tool',
      arguments: toolCall.function?.arguments || '{}'
    }
  };
}

function getToolCallsFromCompletion(completion: ProviderCompletion) {
  const choice = completion.choices[0];
  const toolCalls = (choice?.message?.tool_calls ?? []).map(normalizeToolCall);
  return {
    choice,
    text: choice?.message?.content ?? '',
    toolCalls,
    hasToolCalls: choice?.finish_reason === 'tool_calls' || toolCalls.length > 0
  };
}

function mergeStreamToolCalls(target: ChatToolCall[], chunkToolCalls?: ProviderToolCall[]) {
  for (const chunkToolCall of chunkToolCalls ?? []) {
    const index = chunkToolCall.index ?? target.length;
    const current = target[index] ?? {
      id: `tool_call_${index}`,
      type: 'function',
      function: {
        name: '',
        arguments: ''
      }
    };

    if (chunkToolCall.id) {
      current.id = chunkToolCall.id;
    }
    if (chunkToolCall.type) {
      current.type = 'function';
    }
    if (chunkToolCall.function?.name) {
      current.function.name += chunkToolCall.function.name;
    }
    if (chunkToolCall.function?.arguments) {
      current.function.arguments += chunkToolCall.function.arguments;
    }

    target[index] = current;
  }
}

export function shouldUseTools(messages: ChatMessage[]) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  return latestUserMessage ? /time|时间|timezone|date|calculate|math|算|search|搜索/i.test(latestUserMessage.content) : false;
}

export async function runNonStreamToolLoop(
  provider: NonStreamDependencies,
  params: LoopParams
): Promise<ToolLoopResult> {
  const conversationMessages = [...params.messages];
  const toolMessages: ChatMessage[] = [];
  let usage: ProviderUsage = {};

  for (let depth = 0; depth <= MAX_TOOL_LOOP_DEPTH; depth += 1) {
    const completion = await provider.chatNonStream({
      model: params.model,
      messages: toProviderMessages(conversationMessages),
      tools: TOOL_DEFINITIONS,
      temperature: params.temperature,
      max_tokens: params.max_tokens
    });

    usage = addUsage(usage, completion.usage);
    const { text, toolCalls, hasToolCalls } = getToolCallsFromCompletion(completion);

    if (!hasToolCalls) {
      return { text, usage, toolMessages };
    }

    if (depth === MAX_TOOL_LOOP_DEPTH) {
      throw toolLoopLimitError();
    }

    conversationMessages.push({
      role: 'assistant',
      content: text,
      tool_calls: toolCalls
    });

    const execution = await executeToolCalls(toolCalls);
    conversationMessages.push(...execution.providerMessages);
    toolMessages.push(...execution.displayMessages);
  }

  throw toolLoopLimitError();
}

export async function runStreamToolLoop(
  provider: StreamDependencies,
  params: LoopParams & {
    onTextDelta: (delta: string) => void;
    onToolMessage: (message: ChatMessage) => void;
    onController?: (controller: ProviderStreamResult['controller']) => void;
  }
): Promise<ToolLoopResult> {
  const conversationMessages = [...params.messages];
  const toolMessages: ChatMessage[] = [];
  let usage: ProviderUsage = {};

  for (let depth = 0; depth <= MAX_TOOL_LOOP_DEPTH; depth += 1) {
    const stream = await provider.chatStream({
      model: params.model,
      messages: toProviderMessages(conversationMessages),
      tools: TOOL_DEFINITIONS,
      temperature: params.temperature,
      max_tokens: params.max_tokens
    });

    params.onController?.(stream.controller);

    let turnText = '';
    let finishReason: string | null | undefined;
    const toolCalls: ChatToolCall[] = [];
    const bufferedTextDeltas: string[] = [];

    for await (const chunk of stream) {
      usage = addUsage(usage, chunk.usage);

      const choice = chunk.choices?.[0];
      if (!choice) {
        continue;
      }

      mergeStreamToolCalls(toolCalls, choice.delta?.tool_calls);

      const deltaText = choice.delta?.content ?? '';
      if (deltaText) {
        turnText += deltaText;
        bufferedTextDeltas.push(deltaText);
      }

      finishReason = choice.finish_reason ?? finishReason;
    }

    const normalizedToolCalls = toolCalls.map(normalizeToolCall);
    const hasToolCalls = finishReason === 'tool_calls' || normalizedToolCalls.length > 0;

    if (!hasToolCalls) {
      for (const deltaText of bufferedTextDeltas) {
        params.onTextDelta(deltaText);
      }
      return { text: turnText, usage, toolMessages };
    }

    if (depth === MAX_TOOL_LOOP_DEPTH) {
      throw toolLoopLimitError();
    }

    conversationMessages.push({
      role: 'assistant',
      content: turnText,
      tool_calls: normalizedToolCalls
    });

    const execution = await executeToolCalls(normalizedToolCalls);
    conversationMessages.push(...execution.providerMessages);
    toolMessages.push(...execution.displayMessages);
    for (const toolMessage of execution.displayMessages) {
      params.onToolMessage(toolMessage);
    }
  }

  throw toolLoopLimitError();
}
