# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Build & Dev Commands

```bash
pnpm install          # install all dependencies (root + workspaces)
pnpm dev              # run both server and web in parallel (hot-reload)
pnpm build            # build both packages

# Individual packages
cd server && pnpm dev   # server only (tsx watch, port 8787)
cd web && pnpm dev      # frontend only (Vite, port 5173)
```

No test runner is configured yet.

## Architecture

**Monorepo** (pnpm workspaces): `server/` and `web/`.

### Server (`server/` — Express + TypeScript)

- **Entry:** `src/index.ts` — Express app, mounts `/chat` and `/chat/stream` routes
- **Routes:** `src/routes/chat.ts` (JSON response) and `src/routes/chat-stream.ts` (SSE response)
- **Request flow:** auth guard → system prompt merge → model router → provider call → response
- **Core modules:**
  - `core/auth.ts` — validates user + balance via mock DB
  - `core/router.ts` — selects model based on input (explicit model, tool-call heuristic, context length, or default)
  - `core/provider.ts` — calls OpenAI-compatible API (uses `openai` SDK)
  - `core/sse.ts` — SSE event formatting helpers
  - `core/prompt.ts` — system prompt + tool definitions
  - `core/logger.ts` — structured request logging (latency, tokens, trace_id)
- **Mock data:** `src/mock/db.ts` — hardcoded users (`u_001` active/pro, `u_003` inactive/zero-balance)
- **Config:** `server/.env` (copy from `.env.example`); requires `LLM_API_KEY`, optional `LLM_BASE_URL`

### Web (`web/` — React + Vite + TypeScript)

- Single-component app: `src/App.tsx` handles chat UI with incremental SSE rendering
- `src/api.ts` — API client with SSE stream parser
- `src/types.ts` — shared TypeScript types
