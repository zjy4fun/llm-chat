export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  tool_call_id?: string;
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
