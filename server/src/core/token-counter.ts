import { encoding_for_model, get_encoding } from 'tiktoken';
import type { ChatMessage } from '../types/chat.js';

const encoderCache = new Map<string, ReturnType<typeof get_encoding>>();

function getEncoder(model: string) {
  const cacheKey = model || 'cl100k_base';
  const cached = encoderCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let encoder: ReturnType<typeof get_encoding>;
  try {
    encoder = encoding_for_model(model as Parameters<typeof encoding_for_model>[0]);
  } catch {
    encoder = get_encoding('cl100k_base');
  }

  encoderCache.set(cacheKey, encoder);
  return encoder;
}

export function countTextTokens(model: string, text: string): number {
  return getEncoder(model).encode(text).length;
}

export function countChatMessageTokens(model: string, message: ChatMessage): number {
  let total = 4;
  total += countTextTokens(model, message.content ?? '');

  if (message.name) {
    total += countTextTokens(model, message.name);
  }

  if (message.tool_call_id) {
    total += countTextTokens(model, message.tool_call_id);
  }

  if (message.tool_calls?.length) {
    total += countTextTokens(model, JSON.stringify(message.tool_calls));
  }

  return Math.max(total, 1);
}

export function countChatMessagesTokens(model: string, messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + countChatMessageTokens(model, message), 0);
}
