export type Role = 'user' | 'assistant' | 'system' | 'tool';

export interface ChatMessage {
  role: Role;
  content: string;
  displayOnly?: boolean;
}

export interface TokenUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
}

export interface TokenUsageSummary {
  context_tokens_used?: number | null;
  usage?: TokenUsage | null;
}

export interface NonStreamChatResponse extends TokenUsageSummary {
  message: ChatMessage;
  tool_messages?: ChatMessage[];
}

export interface StreamToolEvent {
  type: 'tool';
  message: ChatMessage;
}

export interface StreamDoneEvent extends TokenUsageSummary {
  type?: 'done';
  text?: string;
  tool_messages?: ChatMessage[];
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
