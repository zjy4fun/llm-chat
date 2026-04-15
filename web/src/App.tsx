import { useEffect, useMemo, useRef, useState } from 'react';
import { BotMessageSquare, Sparkles } from 'lucide-react';
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
import { ChatHeader } from './components/ChatHeader';
import { ChatInput } from './components/ChatInput';
import { ChatMessage } from './components/ChatMessage';
import { ConversationSidebar } from './components/ConversationSidebar';
import { SettingsPanel } from './components/SettingsPanel';
import { Card } from './components/ui/card';
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [cachedConversations, setCachedConversations] = useState<CachedConversationRecord[]>([]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
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

  const upsertConversation = (conversation: ConversationSummary) => {
    setConversations((prev) => {
      const next = [conversation, ...prev.filter((item) => item.id !== conversation.id)];
      return next.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    });
  };

  const handleSelectConversation = async (conversation: ConversationSummary) => {
    setCurrentConversationId(conversation.id);
    setSessionId(conversation.id);

    const cached = await cache.get(conversation.id);
    if (cached) {
      setMessages(cached.messages);
      setCachedConversations((prev) => {
        const rest = prev.filter((entry) => entry.conversation.id !== conversation.id);
        return [cached, ...rest].sort((a, b) => b.lastViewedAt - a.lastViewedAt).slice(0, 50);
      });
      return;
    }

    const response = await getConversationMessages(conversation.id, userId);
    setMessages(response.items);
    upsertConversation(response.conversation);
    await syncCachedConversation(response.conversation, response.items);
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
        const nextMessages = [...nextUserMessages, { role: 'assistant' as const, content: result.text }];
        setMessages(nextMessages);
        await updateConversationAfterSend(conversation, nextMessages);
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
        setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

        await sendStream(
          payload,
          (delta) => {
            aiText += delta;
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = { role: 'assistant', content: aiText };
              return copy;
            });
          },
          async () => {
            const nextMessages = [...nextUserMessages, { role: 'assistant' as const, content: aiText }];
            setMessages(nextMessages);
            await updateConversationAfterSend(conversation, nextMessages);
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
    <main className="relative min-h-screen overflow-hidden px-3 py-3 sm:px-6 sm:py-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="ambient-orb absolute left-[6%] top-12 size-36 rounded-full bg-primary/12 blur-3xl" />
        <div
          className="ambient-orb absolute right-[8%] top-[28%] size-44 rounded-full bg-accent/15 blur-3xl"
          style={{ animationDelay: '-6s' }}
        />
        <div
          className="ambient-orb absolute bottom-[8%] left-[18%] size-52 rounded-full bg-secondary/20 blur-3xl"
          style={{ animationDelay: '-2s' }}
        />
      </div>

      <Card className="relative mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-7xl flex-col overflow-hidden border-border/60 bg-card/82">
        <ChatHeader
          messageCount={messages.length}
          mode={mode}
          model={model}
          modelOptions={modelOptions}
          onModeChange={setMode}
          onModelChange={setModel}
          onToggleSettings={() => setSettingsOpen((prev) => !prev)}
          sessionId={currentConversationId ?? sessionId}
          settingsOpen={settingsOpen}
        />

        <SettingsPanel
          mode={mode}
          model={model}
          onModeChange={setMode}
          onModelChange={setModel}
          onSessionIdChange={setSessionId}
          onUserIdChange={setUserId}
          open={settingsOpen}
          sessionId={currentConversationId ?? sessionId}
          userId={userId}
        />

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <ConversationSidebar
            conversations={filteredConversations}
            currentConversationId={currentConversationId}
            loading={loading && conversations.length === 0}
            onCreateConversation={() => void handleCreateConversation()}
            onDeleteConversation={(conversation) => void handleDeleteConversation(conversation)}
            onRenameConversation={(conversation) => void handleRenameConversation(conversation)}
            onSearchQueryChange={setSearchQuery}
            onSelectConversation={(conversation) => void handleSelectConversation(conversation)}
            searchQuery={searchQuery}
          />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6">
                {messages.length === 0 ? (
                  <div className="flex min-h-[52vh] items-center justify-center py-8">
                    <div className="relative max-w-2xl overflow-hidden rounded-[2rem] border border-border/70 bg-background/55 p-8 shadow-[0_24px_70px_-42px_rgba(0,0,0,0.95)]">
                      <div
                        aria-hidden="true"
                        className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent"
                      />
                      <div className="relative space-y-6">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                          <div className="flex size-14 items-center justify-center rounded-full bg-primary/14 text-primary ring-1 ring-inset ring-primary/20">
                            <BotMessageSquare className="size-6" />
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.32em] text-muted-foreground">
                              <Sparkles className="size-3.5" />
                              Conversation Workspace
                            </div>
                            <h2 className="font-display text-3xl leading-none sm:text-4xl">Pick a thread or start a new one.</h2>
                            <p className="max-w-xl text-sm leading-7 text-muted-foreground sm:text-[15px]">
                              Use the sidebar to browse previous chats, search cached content, and keep recently viewed
                              conversations available locally without another network round trip.
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-[1.4rem] border border-border/70 bg-secondary/55 p-4">
                            <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">History</p>
                            <p className="mt-2 text-sm leading-6 text-foreground">Load recent conversations from the sidebar and resume them instantly.</p>
                          </div>
                          <div className="rounded-[1.4rem] border border-border/70 bg-secondary/45 p-4">
                            <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Search</p>
                            <p className="mt-2 text-sm leading-6 text-foreground">Filter by conversation title or locally cached message content.</p>
                          </div>
                          <div className="rounded-[1.4rem] border border-border/70 bg-secondary/40 p-4">
                            <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Cache</p>
                            <p className="mt-2 text-sm leading-6 text-foreground">Recently viewed threads stay in IndexedDB with LRU eviction after roughly 50 entries.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div aria-live="polite" className="flex flex-col gap-5">
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

            <div className="border-t border-border/60 bg-background/18 px-4 py-4 sm:px-6">
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
          </div>
        </div>
      </Card>
    </main>
  );
}
