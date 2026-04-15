import OpenAI from 'openai';
import type { ChatMessage } from '../types/chat.js';

export interface ProviderParams {
  model: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  temperature?: number;
  max_tokens?: number;
}

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

export async function chatNonStream(params: ProviderParams) {
  return getClient().chat.completions.create({
    model: params.model,
    messages: params.messages,
    tools: params.tools,
    temperature: params.temperature ?? 0.7,
    max_tokens: params.max_tokens ?? 512,
    stream: false
  });
}

export async function chatStream(params: ProviderParams) {
  return getClient().chat.completions.create({
    model: params.model,
    messages: params.messages,
    tools: params.tools,
    temperature: params.temperature ?? 0.7,
    max_tokens: params.max_tokens ?? 512,
    stream: true,
    stream_options: { include_usage: true }
  });
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
      return { role: 'assistant', content: m.content };
    }
    if (m.role === 'system') {
      return { role: 'system', content: m.content };
    }
    return { role: 'user', content: m.content };
  });
}
