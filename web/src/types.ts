export type Role = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  role: Role;
  content: string;
}

export type Mode = 'stream' | 'non-stream';

export interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  mode: Mode;
  session_id: string;
  conversation_id?: string;
  user_id: string;
  trace_id: string;
  temperature?: number;
}
