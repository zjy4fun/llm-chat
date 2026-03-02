import type { ChatMessage } from '../types/chat.js';

export const SYSTEM_PROMPT =
  'You are a concise helpful assistant. If a tool is useful, call it with correct JSON arguments.';

export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_time',
      description: 'Get current server time in ISO string',
      parameters: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: 'IANA timezone like Asia/Shanghai' }
        },
        required: []
      }
    }
  }
];

export function buildMessages(userMessages: ChatMessage[]) {
  const messages = [{ role: 'system' as const, content: SYSTEM_PROMPT }, ...userMessages];
  return messages;
}
