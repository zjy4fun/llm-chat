import type { ChatMessage } from '../types/chat.js';
import { countChatMessageTokens } from './token-counter.js';

export interface ContextWindowResult {
  messages: ChatMessage[];
  contextTokensUsed: number;
  promptTokenBudget: number;
  truncatedMessageCount: number;
}

export function getConfiguredMaxContextTokens(): number {
  const raw = Number(process.env.LLM_MAX_CONTEXT_TOKENS);
  return Number.isFinite(raw) && raw > 0 ? raw : 8000;
}

export function getResponseTokenReserve(maxTokens?: number): number {
  if (typeof maxTokens === 'number' && maxTokens > 0) {
    return maxTokens;
  }

  const raw = Number(process.env.LLM_RESPONSE_TOKEN_RESERVE);
  return Number.isFinite(raw) && raw > 0 ? raw : 512;
}

export function buildContextWindow(options: {
  model: string;
  messages: ChatMessage[];
  maxContextTokens?: number;
  responseTokenReserve?: number;
  countMessageTokens?: (message: ChatMessage) => number;
}): ContextWindowResult {
  const countMessageTokens = options.countMessageTokens ?? ((message: ChatMessage) => countChatMessageTokens(options.model, message));
  const maxContextTokens = options.maxContextTokens ?? getConfiguredMaxContextTokens();
  const responseTokenReserve = options.responseTokenReserve ?? getResponseTokenReserve();
  const promptTokenBudget = Math.max(1, maxContextTokens - responseTokenReserve);

  if (options.messages.length === 0) {
    return {
      messages: [],
      contextTokensUsed: 0,
      promptTokenBudget,
      truncatedMessageCount: 0
    };
  }

  const systemMessages = options.messages.filter((message) => message.role === 'system');
  const nonSystemMessages = options.messages.filter((message) => message.role !== 'system');

  const selectedTail: ChatMessage[] = [];
  let tailTokensUsed = 0;

  for (let index = nonSystemMessages.length - 1; index >= 0; index -= 1) {
    const message = nonSystemMessages[index];
    const messageTokens = countMessageTokens(message);
    const nextTotal = tailTokensUsed + messageTokens;

    if (nextTotal <= promptTokenBudget || selectedTail.length === 0) {
      selectedTail.unshift(message);
      tailTokensUsed = nextTotal;
    }
  }

  const messages = [...systemMessages, ...selectedTail];
  const contextTokensUsed = messages.reduce((sum, message) => sum + countMessageTokens(message), 0);

  return {
    messages,
    contextTokensUsed,
    promptTokenBudget,
    truncatedMessageCount: options.messages.length - messages.length
  };
}
