import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquarePlus, Search } from 'lucide-react';
import {
  createConversation,
  deleteConversation,
  getConversationMessages,
  listConversations,
  makePayload,
  RateLimitError,
  renameConversation,
  sendNonStream,
  sendStream,
  toCachedConversation
} from './api';
import { ChatInput } from './components/ChatInput';
import { ChatMessage } from './components/ChatMessage';
import { ConversationSidebar } from './components/ConversationSidebar';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './components/ui/select';
import { ScrollArea } from './components/ui/scroll-area';
import { createConversationCache } from './lib/conversation-cache';
import type {
  CachedConversationRecord,
  ChatMessage as ChatMessageData,
  ConversationSummary,
  Mode,
  RateLimitStatus,
  StreamDoneEvent,
  TokenUsageSummary
} from './types';

const COMMON_MODELS = [
  { value: 'auto', label: 'Auto router' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4o', label: 'GPT-4o' }
];

const NEW_CONVERSATION_TITLE = 'New conversation';

function getRateLimitCountdownSeconds(rateLimit: RateLimitStatus | null, now: number): number | null {
  if (!rateLimit) {
    return null;
  }

  const resetAt = new Date(rateLimit.reset_at).getTime();
  if (!Number.isFinite(resetAt)) {
    return null;
  }

  return Math.max(Math.ceil((resetAt - now) / 1000), 0);
}

function formatRateLimitReset(rateLimit: RateLimitStatus | null, now: number): string | null {
  const countdownSeconds = getRateLimitCountdownSeconds(rateLimit, now);
  if (countdownSeconds === null) {
    return null;
  }

  return countdownSeconds === 0 ? 'Resets now' : `Resets in about ${countdownSeconds}s`;
}

function toFriendlyRateLimitMessage(rateLimit: RateLimitStatus | null, fallback: string): string {
  const retryAfterSeconds = rateLimit?.retry_after_seconds ?? getRateLimitCountdownSeconds(rateLimit, Date.now());
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return `Rate limit reached. Try again in ${retryAfterSeconds}s.`;
  }

  return fallback;
}

export default function App() {
  const [mode, setMode] = useState<Mode>('stream');
  const [model, setModel] = useState('auto');
  const [userId, setUserId] = useState('u_001');
  const [sessionId, setSessionId] = useState('s_demo_001');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [latestTokenUsage, setLatestTokenUsage] = useState<TokenUsageSummary | null>(null);
  const [rateLimitStatus, setRateLimitStatus] = useState<RateLimitStatus | null>(null);
  const [rateLimitNow, setRateLimitNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [cachedConversations, setCachedConversations] = useState<CachedConversationRecord[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const revalidationControllerRef = useRef<AbortController | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const streamRafRef = useRef<number | null>(null);
  const streamAssistantIndexRef = useRef<number>(-1);
  const streamTextRef = useRef('');
  const streamConversationRef = useRef<ConversationSummary | null>(null);
  const streamPendingUserMessagesRef = useRef<ChatMessageData[] | null>(null);
  const cache = useMemo(() => createConversationCache(), []);

  const currentConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === currentConversationId) ?? null,
    [conversations, currentConversationId]
  );

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);
  const hasTokenUsage = useMemo(() => {
    if (!latestTokenUsage) {
      return false;
    }

    return [
      latestTokenUsage.context_tokens_used,
      latestTokenUsage.usage?.prompt_tokens,
      latestTokenUsage.usage?.completion_tokens,
      latestTokenUsage.usage?.total_tokens
    ].some((value) => typeof value === 'number');
  }, [latestTokenUsage]);
  const rateLimitCountdownSeconds = useMemo(() => getRateLimitCountdownSeconds(rateLimitStatus, rateLimitNow), [rateLimitNow, rateLimitStatus]);
  const rateLimitResetLabel = useMemo(() => formatRateLimitReset(rateLimitStatus, rateLimitNow), [rateLimitNow, rateLimitStatus]);

  const modelOptions = useMemo(() => {
    if (COMMON_MODELS.some((option) => option.value === model)) {
      return COMMON_MODELS;
    }

    return [...COMMON_MODELS, { value: model, label: `Custom · ${model}` }];
  }, [model]);

  const cachedSearchIndex = useMemo(() => {
    return new Map(cachedConversations.map((entry) => [entry.conversation.id, entry.contentText.toLowerCase()]));
  }, [cachedConversations]);

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return conversations;
    }

    return conversations.filter((conversation) => {
      const titleMatch = conversation.title.toLowerCase().includes(query);
      const contentMatch = cachedSearchIndex.get(conversation.id)?.includes(query) ?? false;
      return titleMatch || contentMatch;
    });
  }, [cachedSearchIndex, conversations, searchQuery]);

  useEffect(() => {
    activeConversationIdRef.current = currentConversationId;
  }, [currentConversationId]);

  useEffect(() => {
    return () => {
      revalidationControllerRef.current?.abort();
      streamAbortControllerRef.current?.abort();
      if (streamRafRef.current !== null) {
        window.cancelAnimationFrame(streamRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!rateLimitStatus) {
      return;
    }

    setRateLimitNow(Date.now());
    const interval = window.setInterval(() => {
      setRateLimitNow(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [rateLimitStatus]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: loading ? 'auto' : 'smooth', block: 'end' });
  }, [messages, loading]);

  useEffect(() => {
    let cancelled = false;

    async function loadSidebarData() {
      try {
        const [conversationList, cachedEntries] = await Promise.all([listConversations(userId), cache.list()]);
        if (cancelled) return;
        setConversations(conversationList.items);
        setCachedConversations(cachedEntries);
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load conversations', error);
        }
      }
    }

    void loadSidebarData();

    return () => {
      cancelled = true;
    };
  }, [cache, userId]);

  const syncCachedConversation = async (conversation: ConversationSummary, nextMessages: ChatMessageData[]) => {
    const entry = toCachedConversation({ conversation, messages: nextMessages });
    await cache.put(entry);
    setCachedConversations((prev) => {
      const rest = prev.filter((item) => item.conversation.id !== conversation.id);
      return [entry, ...rest].sort((a, b) => b.lastViewedAt - a.lastViewedAt).slice(0, 50);
    });
  };

  const touchCachedConversation = async (entry: CachedConversationRecord) => {
    const touchedEntry = { ...entry, lastViewedAt: Date.now() };
    await cache.put(touchedEntry);
    setCachedConversations((prev) => {
      const rest = prev.filter((item) => item.conversation.id !== touchedEntry.conversation.id);
      return [touchedEntry, ...rest].sort((a, b) => b.lastViewedAt - a.lastViewedAt).slice(0, 50);
    });
    return touchedEntry;
  };

  const upsertConversation = (conversation: ConversationSummary) => {
    setConversations((prev) => {
      const next = [conversation, ...prev.filter((item) => item.id !== conversation.id)];
      return next.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    });
  };

  const haveMessagesChanged = (left: ChatMessageData[], right: ChatMessageData[]) => {
    if (left.length !== right.length) {
      return true;
    }

    return left.some((message, index) => {
      const other = right[index];
      return message.role !== other?.role || message.content !== other?.content;
    });
  };

  const didConversationChange = (cached: CachedConversationRecord | null, conversation: ConversationSummary, nextMessages: ChatMessageData[]) => {
    if (!cached) {
      return true;
    }

    return (
      cached.conversation.updated_at !== conversation.updated_at ||
      cached.conversation.title !== conversation.title ||
      cached.conversation.message_count !== conversation.message_count ||
      haveMessagesChanged(cached.messages, nextMessages)
    );
  };

  const revalidateConversation = async (
    conversation: ConversationSummary,
    cached: CachedConversationRecord | null,
    signal: AbortSignal
  ) => {
    const response = await getConversationMessages(conversation.id, userId, signal);
    if (signal.aborted) {
      return;
    }

    const conversationChanged = didConversationChange(cached, response.conversation, response.items);
    upsertConversation(response.conversation);

    if (conversationChanged) {
      await syncCachedConversation(response.conversation, response.items);
    }

    if (activeConversationIdRef.current !== conversation.id) {
      return;
    }

    if (!cached || conversationChanged) {
      setMessages(response.items);
    }
  };

  const handleSelectConversation = async (conversation: ConversationSummary) => {
    setCurrentConversationId(conversation.id);
    setSessionId(conversation.id);
    setLatestTokenUsage(null);
    activeConversationIdRef.current = conversation.id;

    revalidationControllerRef.current?.abort();
    const controller = new AbortController();
    revalidationControllerRef.current = controller;

    const cached = await cache.get(conversation.id);
    if (activeConversationIdRef.current !== conversation.id) {
      controller.abort();
      return;
    }

    if (cached) {
      setMessages(cached.messages);
      await touchCachedConversation(cached);
      void revalidateConversation(conversation, cached, controller.signal).catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }
        console.error('Failed to revalidate conversation', error);
      });
      return;
    }

    setMessages([]);

    try {
      await revalidateConversation(conversation, null, controller.signal);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }
      console.error('Failed to load conversation', error);
    }
  };

  const handleCreateConversation = async () => {
    const response = await createConversation(userId, NEW_CONVERSATION_TITLE);
    upsertConversation(response.conversation);
    setCurrentConversationId(response.conversation.id);
    setSessionId(response.conversation.id);
    setMessages([]);
    setLatestTokenUsage(null);
    await syncCachedConversation(response.conversation, []);
  };

  const handleRenameConversation = async (conversation: ConversationSummary, nextTitle?: string) => {
    const title = nextTitle ?? window.prompt('Rename conversation', conversation.title)?.trim();
    if (!title) return;

    const response = await renameConversation(conversation.id, userId, title);
    upsertConversation(response.conversation);
    if (currentConversationId === conversation.id) {
      await syncCachedConversation(response.conversation, messages);
    } else {
      const cached = cachedConversations.find((entry) => entry.conversation.id === conversation.id);
      if (cached) {
        await syncCachedConversation(response.conversation, cached.messages);
      }
    }
  };

  const handleDeleteConversation = async (conversation: ConversationSummary) => {
    const confirmed = window.confirm(`Delete “${conversation.title}”?`);
    if (!confirmed) return;

    await deleteConversation(conversation.id, userId);
    setConversations((prev) => prev.filter((item) => item.id !== conversation.id));
    setCachedConversations((prev) => prev.filter((item) => item.conversation.id !== conversation.id));
    await cache.delete(conversation.id);

    if (currentConversationId === conversation.id) {
      setCurrentConversationId(null);
      setMessages([]);
      setLatestTokenUsage(null);
      setSessionId('s_demo_001');
    }
  };

  const ensureConversationForSend = async (prompt: string) => {
    if (currentConversation) {
      return currentConversation;
    }

    const response = await createConversation(userId, undefined, prompt);
    upsertConversation(response.conversation);
    setCurrentConversationId(response.conversation.id);
    setSessionId(response.conversation.id);
    return response.conversation;
  };

  const updateConversationAfterSend = async (conversation: ConversationSummary, nextMessages: ChatMessageData[]) => {
    const updatedConversation: ConversationSummary = {
      ...conversation,
      title: conversation.title === NEW_CONVERSATION_TITLE && nextMessages.length > 0 ? nextMessages[0].content : conversation.title,
      message_count: nextMessages.length,
      updated_at: new Date().toISOString()
    };

    upsertConversation(updatedConversation);
    await syncCachedConversation(updatedConversation, nextMessages);

    if (conversation.title === NEW_CONVERSATION_TITLE && nextMessages.length > 0) {
      await handleRenameConversation(updatedConversation, nextMessages[0].content);
    }
  };

  const flushStreamToState = () => {
    setMessages((prev) => {
      const copy = [...prev];
      if (streamAssistantIndexRef.current === -1) {
        copy.push({ role: 'assistant', content: streamTextRef.current });
        streamAssistantIndexRef.current = copy.length - 1;
        return copy;
      }
      copy[streamAssistantIndexRef.current] = { role: 'assistant', content: streamTextRef.current };
      return copy;
    });
  };

  const scheduleStreamFlush = () => {
    if (streamRafRef.current !== null) {
      return;
    }
    streamRafRef.current = window.requestAnimationFrame(() => {
      streamRafRef.current = null;
      flushStreamToState();
    });
  };

  const handleStopGenerating = async () => {
    if (!loading || mode !== 'stream') {
      return;
    }

    streamAbortControllerRef.current?.abort();

    if (!streamConversationRef.current || !streamPendingUserMessagesRef.current || !streamTextRef.current) {
      return;
    }

    flushStreamToState();
    const persistedNextMessages = [
      ...streamPendingUserMessagesRef.current,
      { role: 'assistant' as const, content: streamTextRef.current }
    ];
    await updateConversationAfterSend(streamConversationRef.current, persistedNextMessages);
  };

  const onSend = async () => {
    const prompt = input.trim();
    if (!prompt) return;

    setLoading(true);
    setInput('');

    try {
      const conversation = await ensureConversationForSend(prompt);
      const history = [...messages];
      const nextUserMessages = [...history, { role: 'user' as const, content: prompt }];
      setLatestTokenUsage(null);
      setRateLimitNow(Date.now());
      setMessages(nextUserMessages);

      if (mode === 'non-stream') {
        const payload = makePayload({
          history,
          prompt,
          mode,
          model,
          userId,
          sessionId: conversation.id,
          conversationId: conversation.id
        });
        const result = await sendNonStream(payload);
        setLatestTokenUsage({
          context_tokens_used: result.raw.context_tokens_used ?? null,
          usage: result.raw.usage ?? null
        });
        setRateLimitStatus(result.raw.rate_limit ?? null);
        const persistedNextMessages = [...nextUserMessages, { role: 'assistant' as const, content: result.text }];
        const visibleNextMessages = [
          ...nextUserMessages,
          ...(result.raw.tool_messages ?? []).map((message) => ({ ...message, displayOnly: true })),
          { role: 'assistant' as const, content: result.text }
        ];
        setMessages(visibleNextMessages);
        await updateConversationAfterSend(conversation, persistedNextMessages);
      } else {
        const payload = makePayload({
          history,
          prompt,
          mode,
          model,
          userId,
          sessionId: conversation.id,
          conversationId: conversation.id
        });
        streamTextRef.current = '';
        streamAssistantIndexRef.current = -1;
        streamConversationRef.current = conversation;
        streamPendingUserMessagesRef.current = nextUserMessages;
        const streamController = new AbortController();
        streamAbortControllerRef.current = streamController;

        await sendStream(
          payload,
          (delta) => {
            streamTextRef.current += delta;
            scheduleStreamFlush();
          },
          async (doneEvent: StreamDoneEvent) => {
            setLatestTokenUsage({
              context_tokens_used: doneEvent.context_tokens_used ?? null,
              usage: doneEvent.usage ?? null
            });
            setRateLimitStatus(doneEvent.rate_limit ?? null);
            flushStreamToState();
            const persistedNextMessages = [...nextUserMessages, { role: 'assistant' as const, content: streamTextRef.current }];
            await updateConversationAfterSend(conversation, persistedNextMessages);
          },
          (toolEvent) => {
            setMessages((prev) => [...prev, { ...toolEvent.message, displayOnly: true }]);
          },
          { signal: streamController.signal }
        );
      }
    } catch (e: any) {
      const wasAborted = e instanceof DOMException && e.name === 'AbortError';
      if (wasAborted && mode === 'stream') {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: 'Generation stopped.'
          }
        ]);
        return;
      }
      if (e instanceof RateLimitError || e?.status === 429) {
        const rateLimit = e.rateLimit ?? null;
        setRateLimitStatus(rateLimit);
        setRateLimitNow(Date.now());
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: toFriendlyRateLimitMessage(rateLimit, 'Rate limit reached. Please wait a moment and try again.')
          }
        ]);
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${e.message}` }]);
      }
    } finally {
      streamAbortControllerRef.current = null;
      streamConversationRef.current = null;
      streamPendingUserMessagesRef.current = null;
      if (streamRafRef.current !== null) {
        window.cancelAnimationFrame(streamRafRef.current);
        streamRafRef.current = null;
      }
      setLoading(false);
    }
  };

  return (
    <main className="h-screen overflow-hidden bg-background text-foreground">
      <div className="mx-auto flex h-screen max-w-7xl flex-col overflow-hidden">
        <header className="border-b border-border px-4 py-4">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 className="text-2xl font-semibold">LLM Chat</h1>
                <p className="text-sm text-muted-foreground">Conversations, controls, history, and composer all stay on one page.</p>
              </div>

              <Button onClick={() => void handleCreateConversation()} size="sm" variant="secondary">
                <MessageSquarePlus className="size-4" />
                New conversation
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,0.7fr))]">
              <div className="space-y-2">
                <Label htmlFor="conversation-search">Search conversations</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="conversation-search"
                    className="pl-9"
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search conversations"
                    value={searchQuery}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mode-select">Mode</Label>
                <Select value={mode} onValueChange={(value) => setMode(value as Mode)}>
                  <SelectTrigger id="mode-select">
                    <SelectValue placeholder="Select mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stream">Stream</SelectItem>
                    <SelectItem value="non-stream">Non-stream</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="model-select">Model</Label>
                <Select value={model} onValueChange={setModel}>
                  <SelectTrigger id="model-select">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="user-id">User ID</Label>
                <Input id="user-id" onChange={(event) => setUserId(event.target.value)} value={userId} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="session-id">Session ID</Label>
                <Input id="session-id" onChange={(event) => setSessionId(event.target.value)} value={currentConversationId ?? sessionId} />
              </div>
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <ConversationSidebar
            conversations={filteredConversations}
            currentConversationId={currentConversationId}
            loading={loading && conversations.length === 0}
            onDeleteConversation={(conversation) => void handleDeleteConversation(conversation)}
            onRenameConversation={(conversation) => void handleRenameConversation(conversation)}
            onSelectConversation={(conversation) => void handleSelectConversation(conversation)}
          />

          <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="border-b border-border px-4 py-3 text-sm text-muted-foreground">
              {currentConversation ? currentConversation.title : 'Select a conversation or start a new one.'}
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-4">
                {messages.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                    Select a conversation from the left, or create a new one and start typing below.
                  </div>
                ) : (
                  <div aria-live="polite" className="flex flex-col gap-4">
                    {messages.map((message, index) => (
                      <ChatMessage
                        key={`${message.role}-${index}`}
                        isStreaming={loading && mode === 'stream' && index === messages.length - 1 && message.role === 'assistant'}
                        message={message}
                      />
                    ))}

                    {loading && mode === 'non-stream' ? (
                      <ChatMessage isStreaming message={{ role: 'assistant', content: '' }} />
                    ) : null}
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            <div className="shrink-0 border-t border-border px-4 py-4">
              <div className="mx-auto w-full max-w-4xl">
                {rateLimitStatus ? (
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full border border-border bg-secondary/50 px-3 py-1">
                      Rate limit {rateLimitStatus.remaining}/{rateLimitStatus.limit} left
                    </span>
                    {rateLimitCountdownSeconds !== null && rateLimitCountdownSeconds > 0 && rateLimitStatus.remaining === 0 ? (
                      <span className="rounded-full border border-border bg-secondary/50 px-3 py-1">
                        Try again in {rateLimitCountdownSeconds}s
                      </span>
                    ) : null}
                    {rateLimitResetLabel ? (
                      <span className="rounded-full border border-border bg-secondary/50 px-3 py-1">{rateLimitResetLabel}</span>
                    ) : null}
                  </div>
                ) : null}
                {hasTokenUsage ? (
                  <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {typeof latestTokenUsage?.context_tokens_used === 'number' ? (
                      <span className="rounded-full border border-border bg-secondary/50 px-3 py-1">
                        Context {latestTokenUsage.context_tokens_used} tokens
                      </span>
                    ) : null}
                    {typeof latestTokenUsage?.usage?.prompt_tokens === 'number' ? (
                      <span className="rounded-full border border-border bg-secondary/50 px-3 py-1">
                        Prompt {latestTokenUsage.usage.prompt_tokens}
                      </span>
                    ) : null}
                    {typeof latestTokenUsage?.usage?.completion_tokens === 'number' ? (
                      <span className="rounded-full border border-border bg-secondary/50 px-3 py-1">
                        Completion {latestTokenUsage.usage.completion_tokens}
                      </span>
                    ) : null}
                    {typeof latestTokenUsage?.usage?.total_tokens === 'number' ? (
                      <span className="rounded-full border border-border bg-secondary/50 px-3 py-1">
                        Total {latestTokenUsage.usage.total_tokens}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <ChatInput
                  canStop={loading && mode === 'stream'}
                  disabled={!canSend}
                  loading={loading}
                  mode={mode}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      if (canSend) {
                        void onSend();
                      }
                    }
                  }}
                  onSend={() => {
                    if (canSend) {
                      void onSend();
                    }
                  }}
                  onStop={() => {
                    void handleStopGenerating();
                  }}
                  onValueChange={setInput}
                  value={input}
                />
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
