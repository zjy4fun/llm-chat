import { useMemo, useState } from 'react';
import { makePayload, sendNonStream, sendStream } from './api';
import type { ChatMessage, Mode } from './types';

export default function App() {
  const [mode, setMode] = useState<Mode>('stream');
  const [model, setModel] = useState('auto');
  const [userId, setUserId] = useState('u_001');
  const [sessionId, setSessionId] = useState('s_demo_001');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

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
        setMessages((prev) => [...prev, { role: 'assistant', content: result.text }]);
      } else {
        const payload = makePayload({ history, prompt, mode, model, userId, sessionId });
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
          () => {
            // done event hook
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
    <div style={{ maxWidth: 900, margin: '24px auto', fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h2>llm-chat demo (TypeScript)</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="stream">stream</option>
          <option value="non-stream">non-stream</option>
        </select>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="model (auto)" />
        <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="user_id" />
        <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="session_id" />
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, minHeight: 280, marginBottom: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ margin: '8px 0' }}>
            <b>{m.role}:</b> {m.content}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          style={{ flex: 1 }}
          placeholder="Type your prompt..."
        />
        <button disabled={!canSend} onClick={onSend}>
          {loading ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
