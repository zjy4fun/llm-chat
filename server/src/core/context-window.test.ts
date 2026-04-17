import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../types/chat.js';
import { buildContextWindow } from './context-window.js';

function makeMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return { role, content };
}

describe('core/context-window', () => {
  const countMessageTokens = (message: ChatMessage) => Number(message.content);

  it('returns an empty history unchanged', () => {
    const result = buildContextWindow({
      model: 'gpt-4o-mini',
      messages: [],
      maxContextTokens: 100,
      responseTokenReserve: 10,
      countMessageTokens
    });

    expect(result.messages).toEqual([]);
    expect(result.contextTokensUsed).toBe(0);
  });

  it('keeps all messages at the exact token boundary', () => {
    const messages = [
      makeMessage('system', '2'),
      makeMessage('user', '3'),
      makeMessage('assistant', '4')
    ];

    const result = buildContextWindow({
      model: 'gpt-4o-mini',
      messages,
      maxContextTokens: 19,
      responseTokenReserve: 10,
      countMessageTokens
    });

    expect(result.messages).toEqual(messages);
    expect(result.contextTokensUsed).toBe(9);
  });

  it('drops older messages first when the history exceeds the budget', () => {
    const messages = [
      makeMessage('system', '2'),
      makeMessage('user', '3'),
      makeMessage('assistant', '4'),
      makeMessage('user', '5')
    ];

    const result = buildContextWindow({
      model: 'gpt-4o-mini',
      messages,
      maxContextTokens: 19,
      responseTokenReserve: 10,
      countMessageTokens
    });

    expect(result.messages).toEqual([
      makeMessage('system', '2'),
      makeMessage('assistant', '4'),
      makeMessage('user', '5')
    ]);
    expect(result.contextTokensUsed).toBe(11);
  });

  it('keeps the newest message even when it is larger than the prompt budget by itself', () => {
    const messages = [
      makeMessage('system', '2'),
      makeMessage('user', '20')
    ];

    const result = buildContextWindow({
      model: 'gpt-4o-mini',
      messages,
      maxContextTokens: 15,
      responseTokenReserve: 10,
      countMessageTokens
    });

    expect(result.messages).toEqual(messages);
    expect(result.contextTokensUsed).toBe(22);
  });
});
