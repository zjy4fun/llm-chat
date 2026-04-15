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

export interface ConversationSummary {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface ConversationListResponse {
  items: ConversationSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface ConversationMessagesResponse {
  conversation: ConversationSummary;
  items: ChatMessage[];
}

export interface ConversationMutationResponse {
  conversation: ConversationSummary;
}

export interface CachedConversationRecord {
  conversation: ConversationSummary;
  messages: ChatMessage[];
  contentText: string;
  lastViewedAt: number;
}
