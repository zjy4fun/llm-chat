export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export type ChatMode = 'stream' | 'non-stream';

export interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  mode: ChatMode;
  session_id: string;
  conversation_id?: string;
  user_id: string;
  trace_id: string;
  temperature?: number;
  max_tokens?: number;
}

export interface AuthContext {
  userId: string;
  plan: 'free' | 'pro';
  balance: number;
}
