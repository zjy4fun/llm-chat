import type { ChatMessage } from '../types/chat.js';

export const SYSTEM_PROMPT =
  'You are a concise helpful assistant. If a tool is useful, call it with correct JSON arguments.';

export const TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_time',
      description: 'Get current server time in the requested timezone.',
      parameters: {
        type: 'object',
        properties: {
          timezone: { type: 'string', description: 'IANA timezone like Asia/Shanghai' }
        },
        required: []
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'calculate',
      description: 'Safely calculate a basic arithmetic expression using numbers, parentheses, and + - * / operators.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Arithmetic expression such as (2+3)*4' }
        },
        required: ['expression']
      }
    }
  },
  {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description: 'Search the web for a query and return summarized results. This server currently uses a mock search backend.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }
  }
];

export function buildMessages(userMessages: ChatMessage[]) {
  const messages = [{ role: 'system' as const, content: SYSTEM_PROMPT }, ...userMessages];
  return messages;
}
