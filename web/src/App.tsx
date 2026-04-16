import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquarePlus, Search } from 'lucide-react';
import {
  createConversation,
  deleteConversation,
  getConversationMessages,
  listConversations,
  makePayload,
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
import type { CachedConversationRecord, ChatMessage as ChatMessageData, ConversationSummary, Mode } from './types';

const COMMON_MODELS = [
  { value: 'auto', label: 'Auto router' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4o', label: 'GPT-4o' }
];

const NEW_CONVERSATION_TITLE = 'New conversation';

export default function App() {
  const [mode, setMode] = useState<Mode>('stream');
  const [model, setModel] = useState('auto');
  const [userId, setUserId] = useState('u_001');
  const [sessionId, setSessionId] = useState('s_demo_001');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [loading, setLoading] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [cachedConversations, setCachedConversations] = useState<CachedConversationRecord[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const revalidationControllerRef = useRef<AbortController | null>(null);
  const cache = useMemo(() => createConversationCache(), []);

  const currentConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === currentConversationId) ?? null,
    [conversations, currentConversationId]
  );

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

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
    };
  }, []);

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

  const onSend = async () => {
    const prompt = input.trim();
    if (!prompt) return;

    setLoading(true);
    setInput('');

    try {
      const conversation = await ensureConversationForSend(prompt);
      const history = [...messages];
      const nextUserMessages = [...history, { role: 'user' as const, content: prompt }];
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
        let aiText = '';
        let assistantIndex = -1;

        await sendStream(
          payload,
          (delta) => {
            aiText += delta;
            setMessages((prev) => {
              const copy = [...prev];
              if (assistantIndex === -1) {
                copy.push({ role: 'assistant', content: aiText });
                assistantIndex = copy.length - 1;
                return copy;
              }
              copy[assistantIndex] = { role: 'assistant', content: aiText };
              return copy;
            });
          },
          async () => {
            setMessages((prev) => {
              const copy = [...prev];
              if (assistantIndex === -1) {
                copy.push({ role: 'assistant', content: aiText });
                assistantIndex = copy.length - 1;
                return copy;
              }
              copy[assistantIndex] = { role: 'assistant', content: aiText };
              return copy;
            });
            const persistedNextMessages = [...nextUserMessages, { role: 'assistant' as const, content: aiText }];
            await updateConversationAfterSend(conversation, persistedNextMessages);
          },
          (toolEvent) => {
            setMessages((prev) => [...prev, { ...toolEvent.message, displayOnly: true }]);
          }
        );
      }
    } catch (e: any) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${e.message}` }]);
    } finally {
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
                <ChatInput
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
