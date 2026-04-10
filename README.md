# llm-chat

A minimal, full-stack **LLM Chat demo** built with TypeScript end-to-end.

- **Frontend:** React + Vite + TypeScript
- **Backend:** Express + TypeScript
- **Provider:** OpenAI-compatible API (switch providers via `LLM_BASE_URL`)
- **Modes:** Stream (SSE) / Non-stream (JSON)

## Quick Start

```bash
pnpm install
cp server/.env.example server/.env
# Edit server/.env — set LLM_API_KEY (and optionally LLM_BASE_URL)
pnpm dev
```

- Frontend: http://localhost:5173
- Backend: http://localhost:8787

## Request Format (Frontend → Backend)

```json
{
  "messages": [{ "role": "user", "content": "Hello" }],
  "model": "auto",
  "mode": "stream",
  "session_id": "s_demo_001",
  "user_id": "u_001",
  "trace_id": "trace_xxx"
}
```

## Core Flow

1. Frontend sends `POST /chat` (non-stream) or `POST /chat/stream` (stream)
2. Backend runs auth guard (user validation + balance check)
3. Merges system prompt + user messages + tool definitions + sampling params
4. Router selects the target model
5. Calls provider
   - Non-stream: returns full completion as JSON
   - Stream: yields `delta.content` chunks via SSE
6. Response
   - Non-stream: JSON body
   - Stream: SSE events (`event` + `data`)
7. Logs: latency / tokens / trace_id / error

## SSE Event Format

```txt
event: message
data: {"type":"delta","text":"Hello"}

event: done
data: {"type":"done","usage":{"prompt_tokens":...}}
```

## Model Router

`server/src/core/router.ts`

- User explicitly specifies a model (not `auto`) → pass through
- Tool call needed (text matches `time` / `时间`) → tool-capable model
- Large context (> 12k chars) → long-context model
- Default → cheap model

## Mock Auth

`server/src/mock/db.ts`

- `u_001` — active, pro plan (default test user)
- `u_003` — inactive, zero balance (for testing error branches)

## Key Files

| File | Description |
|------|-------------|
| `server/src/routes/chat.ts` | Non-stream chat endpoint |
| `server/src/routes/chat-stream.ts` | Stream chat endpoint (SSE) |
| `server/src/core/provider.ts` | LLM provider calls |
| `server/src/core/router.ts` | Model selection logic |
| `server/src/core/auth.ts` | Auth guard middleware |
| `server/src/core/sse.ts` | SSE helpers |
| `server/src/core/logger.ts` | Structured request logging |
| `web/src/api.ts` | Frontend API + SSE parser |
| `web/src/App.tsx` | Chat UI + incremental rendering |

## Roadmap

See [Issues](https://github.com/zjy4fun/llm-chat/issues) for the full development plan, organized in three phases:

- **Phase 1** — Core completion (persistence, tool calling, context management)
- **Phase 2** — Production infrastructure (auth, rate limiting, multi-provider, observability)
- **Phase 3** — Differentiation (model comparison, export, RAG)

## License

MIT
