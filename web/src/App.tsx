import { useEffect, useMemo, useRef, useState } from 'react';
import { BotMessageSquare, Sparkles } from 'lucide-react';
import { makePayload, sendNonStream, sendStream } from './api';
import { ChatHeader } from './components/ChatHeader';
import { ChatInput } from './components/ChatInput';
import { ChatMessage } from './components/ChatMessage';
import { SettingsPanel } from './components/SettingsPanel';
import { Card } from './components/ui/card';
import { ScrollArea } from './components/ui/scroll-area';
import type { ChatMessage as ChatMessageData, Mode } from './types';

const COMMON_MODELS = [
  { value: 'auto', label: 'Auto router' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4o', label: 'GPT-4o' }
];

export default function App() {
  const [mode, setMode] = useState<Mode>('stream');
  const [model, setModel] = useState('auto');
  const [userId, setUserId] = useState('u_001');
  const [sessionId, setSessionId] = useState('s_demo_001');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  const modelOptions = useMemo(() => {
    if (COMMON_MODELS.some((option) => option.value === model)) {
      return COMMON_MODELS;
    }

    return [...COMMON_MODELS, { value: model, label: `Custom · ${model}` }];
  }, [model]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: loading ? 'auto' : 'smooth', block: 'end' });
  }, [messages, loading]);

  const onSend = async () => {
    const prompt = input.trim();
    if (!prompt) return;

    setLoading(true);
    setInput('');

    const history = [...messages];
    setMessages((prev) => [...prev, { role: 'user', content: prompt }]);

    try {
      if (mode === 'non-stream') {
        const payload = makePayload({ history, prompt, mode, model, userId, sessionId });
        const result = await sendNonStream(payload);
        setMessages((prev) => [
          ...prev,
          ...(result.raw.tool_messages ?? []).map((message) => ({ ...message, displayOnly: true })),
          { role: 'assistant', content: result.text }
        ]);
      } else {
        const payload = makePayload({ history, prompt, mode, model, userId, sessionId });
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
          () => {
            // done event hook
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

      <Card className="relative mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-6xl flex-col overflow-hidden border-border/60 bg-card/82">
        <ChatHeader
          messageCount={messages.length}
          mode={mode}
          model={model}
          modelOptions={modelOptions}
          onModeChange={setMode}
          onModelChange={setModel}
          onToggleSettings={() => setSettingsOpen((prev) => !prev)}
          sessionId={sessionId}
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
          sessionId={sessionId}
          userId={userId}
        />

        <div className="flex min-h-0 flex-1 flex-col">
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
                          <h2 className="font-display text-3xl leading-none sm:text-4xl">Start with a real prompt.</h2>
                          <p className="max-w-xl text-sm leading-7 text-muted-foreground sm:text-[15px]">
                            Switch between live streaming and standard responses, then send a prompt to exercise the
                            same server request path from a cleaner interface.
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-[1.4rem] border border-border/70 bg-secondary/55 p-4">
                          <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Mode</p>
                          <p className="mt-2 text-sm leading-6 text-foreground">Toggle streaming in the header to test incremental SSE rendering.</p>
                        </div>
                        <div className="rounded-[1.4rem] border border-border/70 bg-secondary/45 p-4">
                          <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Routing</p>
                          <p className="mt-2 text-sm leading-6 text-foreground">Pick a preset model or override it in settings when you need a custom backend name.</p>
                        </div>
                        <div className="rounded-[1.4rem] border border-border/70 bg-secondary/40 p-4">
                          <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Identity</p>
                          <p className="mt-2 text-sm leading-6 text-foreground">User and session IDs stay editable in the collapsible settings panel.</p>
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
      </Card>
    </main>
  );
}
