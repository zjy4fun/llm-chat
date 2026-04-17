import type {
  CachedConversationRecord,
  ChatMessage,
  ChatRequest,
  ConversationListResponse,
  ConversationMessagesResponse,
  ConversationMutationResponse,
  NonStreamChatResponse,
  StreamDoneEvent,
  StreamToolEvent
} from './types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

export async function sendNonStream(payload: ChatRequest): Promise<{ text: string; raw: NonStreamChatResponse }> {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as NonStreamChatResponse;
  return { text: data.message.content, raw: data };
}

export async function sendStream(
  payload: ChatRequest,
  onDelta: (textDelta: string) => void,
  onDone: (raw: StreamDoneEvent) => void,
  onTool: (event: StreamToolEvent) => void
): Promise<void> {
  const res = await fetch(`${BASE_URL}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(payload)
  });

  if (!res.ok || !res.body) {
    throw new Error(await res.text());
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const evt of events) {
      const lines = evt.split('\n');
      let eventName = 'message';
      let dataStr = '';

      for (const line of lines) {
        if (line.startsWith('event:')) eventName = line.replace('event:', '').trim();
        if (line.startsWith('data:')) dataStr += line.replace('data:', '').trim();
      }

      if (!dataStr) continue;
      const data = JSON.parse(dataStr);

      if (eventName === 'message' && data.type === 'delta') {
        onDelta(String(data.text || ''));
      } else if (eventName === 'tool' && data.type === 'tool' && data.message) {
        onTool(data as StreamToolEvent);
      } else if (eventName === 'done') {
        onDone(data as StreamDoneEvent);
      } else if (eventName === 'error') {
        throw new Error(data.message || 'stream error');
      }
    }
  }
}

export async function createConversation(
  userId: string,
  title?: string,
  firstMessage?: string
): Promise<ConversationMutationResponse> {
  const res = await fetch(`${BASE_URL}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, title, first_message: firstMessage })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listConversations(userId: string, page = 1, pageSize = 20): Promise<ConversationListResponse> {
  const params = new URLSearchParams({
    user_id: userId,
    page: String(page),
    page_size: String(pageSize)
  });
  const res = await fetch(`${BASE_URL}/conversations?${params.toString()}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getConversationMessages(
  conversationId: string,
  userId: string,
  signal?: AbortSignal
): Promise<ConversationMessagesResponse> {
  const params = new URLSearchParams({ user_id: userId });
  const res = await fetch(`${BASE_URL}/conversations/${conversationId}/messages?${params.toString()}`, { signal });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function renameConversation(
  conversationId: string,
  userId: string,
  title: string
): Promise<ConversationMutationResponse> {
  const res = await fetch(`${BASE_URL}/conversations/${conversationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, title })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteConversation(conversationId: string, userId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId })
  });
  if (!res.ok) throw new Error(await res.text());
}

export function makePayload(args: {
  history: ChatMessage[];
  prompt: string;
  mode: 'stream' | 'non-stream';
  model: string;
  userId: string;
  sessionId: string;
  conversationId?: string;
}): ChatRequest {
  const traceId = `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    messages: [...args.history.filter((message) => !message.displayOnly), { role: 'user', content: args.prompt }],
    model: args.model,
    mode: args.mode,
    session_id: args.sessionId,
    conversation_id: args.conversationId,
    user_id: args.userId,
    trace_id: traceId,
    temperature: 0.7
  };
}

export function toCachedConversation(args: {
  conversation: CachedConversationRecord['conversation'];
  messages: ChatMessage[];
}): CachedConversationRecord {
  return {
    conversation: args.conversation,
    messages: args.messages,
    contentText: args.messages.map((message) => message.content).join(' ').trim(),
    lastViewedAt: Date.now()
  };
}
