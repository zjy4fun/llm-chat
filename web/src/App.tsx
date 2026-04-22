import { useEffect, useMemo, useState } from 'react';
import {
  createConversation,
  getUsageMe,
  listConversations,
  login,
  makePayload,
  RateLimitError,
  register,
  sendNonStream,
  sendStream,
  setAuthTokens
} from './api';
import { ChatInput } from './components/ChatInput';
import { ChatMessage } from './components/ChatMessage';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './components/ui/select';
import type { ChatMessage as ChatMessageData, Mode, UsageSummary, UserProfile } from './types';

const COMMON_MODELS = [
  { value: 'auto', label: 'Auto router' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { value: 'gpt-4.1', label: 'GPT-4.1' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'gpt-4o', label: 'GPT-4o' }
];

export default function App() {
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('demo-pro@example.com');
  const [password, setPassword] = useState('demo1234');
  const [me, setMe] = useState<UserProfile | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('stream');
  const [model, setModel] = useState('auto');
  const [sessionId, setSessionId] = useState('s_demo_001');
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  const canSend = input.trim().length > 0 && !loading;
  const modelOptions = useMemo(() => (COMMON_MODELS.some((m) => m.value === model) ? COMMON_MODELS : [...COMMON_MODELS, { value: model, label: model }]), [model]);

  useEffect(() => {
    if (!me) return;
    void getUsageMe().then(setUsage).catch(() => undefined);
    void listConversations().catch(() => undefined);
  }, [me]);

  const submitAuth = async () => {
    const action = authMode === 'login' ? login : register;
    const response = await action(email, password);
    setAuthTokens({ accessToken: response.access_token, refreshToken: response.refresh_token });
    setMe(response.user);
    setUsage(await getUsageMe());
  };

  const ensureConversation = async () => {
    if (conversationId) return conversationId;
    const created = await createConversation('New conversation', input.trim());
    setConversationId(created.conversation.id);
    setSessionId(created.conversation.id);
    return created.conversation.id;
  };

  const onSend = async () => {
    if (!canSend) return;

    const prompt = input.trim();
    setInput('');
    const userMessage: ChatMessageData = { role: 'user', content: prompt };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    try {
      const ensuredConversationId = await ensureConversation();
      const payload = makePayload({
        history: messages,
        prompt,
        mode,
        model,
        sessionId,
        conversationId: ensuredConversationId
      });

      if (mode === 'non-stream') {
        const response = await sendNonStream(payload);
        setMessages((prev) => [...prev, { role: 'assistant', content: response.text }]);
      } else {
        let acc = '';
        setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
        await sendStream(
          payload,
          (delta) => {
            acc += delta;
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: 'assistant', content: acc };
              return next;
            });
          },
          () => undefined,
          () => undefined
        );
      }

      setUsage(await getUsageMe());
    } catch (error) {
      const message = error instanceof RateLimitError ? error.message : error instanceof Error ? error.message : String(error);
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${message}` }]);
    } finally {
      setLoading(false);
    }
  };

  if (!me) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md space-y-3 rounded-xl border p-6">
          <h1 className="text-xl font-semibold">LLM Chat</h1>
          <div className="flex gap-2">
            <Button variant={authMode === 'login' ? 'default' : 'outline'} onClick={() => setAuthMode('login')}>Login</Button>
            <Button variant={authMode === 'register' ? 'default' : 'outline'} onClick={() => setAuthMode('register')}>Register</Button>
          </div>
          <Input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
          <Input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" type="password" />
          <Button className="w-full" onClick={() => void submitAuth()}>{authMode === 'login' ? 'Sign in' : 'Create account'}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <span className="text-sm">{me.email} ({me.plan})</span>
        <Select value={mode} onValueChange={(value: Mode) => setMode(value)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="stream">stream</SelectItem>
            <SelectItem value="non-stream">non-stream</SelectItem>
          </SelectContent>
        </Select>
        <Select value={model} onValueChange={setModel}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {modelOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {usage ? <span className="text-xs text-slate-500">Today: {usage.today_tokens}/{usage.daily_quota}</span> : null}
      </div>
      <div className="flex-1 space-y-2 overflow-auto rounded border p-3">
        {messages.map((message, index) => (
          <ChatMessage key={`${index}-${message.role}`} message={message} isStreaming={loading && index === messages.length - 1 && message.role === 'assistant'} />
        ))}
      </div>
      <ChatInput
        value={input}
        onValueChange={setInput}
        onSend={() => void onSend()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void onSend();
          }
        }}
        disabled={!canSend}
        loading={loading}
        mode={mode}
      />
    </div>
  );
}
