# llm-chat

一个最小可运行的 **LLM Chat 全链路 Demo（TypeScript）**。

- 前端：React + Vite + TS
- 后端：Express + TS
- Provider：OpenAI 兼容接口（通过 `LLM_BASE_URL` 切换三方）
- 支持：stream（SSE） / non-stream（JSON）

## 1. 快速启动

```bash
cd ~/projects/llm-chat
pnpm install
cp server/.env.example server/.env
# 编辑 server/.env 填入 LLM_API_KEY，必要时改 LLM_BASE_URL
pnpm dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:8787

## 2. 请求结构（前端 -> 后端）

```json
{
  "messages": [{"role":"user","content":"你好"}],
  "model": "auto",
  "mode": "stream",
  "session_id": "s_demo_001",
  "user_id": "u_001",
  "trace_id": "trace_xxx"
}
```

## 3. 核心链路

1. 前端提交 `/chat`（non-stream）或 `/chat/stream`（stream）
2. 后端执行 mock 鉴权（user/余额）
3. 合并 system prompt + messages + tools + sampling
4. router 选择具体模型
5. 调 provider
   - non-stream: 一次拿完整结果
   - stream: 逐块拿 `delta.content`
6. 回包
   - non-stream: JSON
   - stream: SSE（`event + data`）
7. 日志记录 latency / tokens / trace_id / error

## 4. SSE 事件格式

```txt
event: message
data: {"type":"delta","text":"你好"}

event: done
data: {"type":"done","usage":{"prompt_tokens":...}}
```

## 5. 模型路由示例

`server/src/core/router.ts`

- 用户显式指定模型且不为 auto -> 直通
- 需要工具（文本中命中 time/时间）-> tool 模型
- 上下文字符量大 -> long-context 模型
- 否则 -> cheap 模型

## 6. mock 鉴权示例

`server/src/mock/db.ts`

- `u_001` 默认可用
- `u_003` inactive / 余额不足场景可测试错误分支

## 7. 关键文件

- server/src/routes/chat.ts：非流式
- server/src/routes/chat-stream.ts：流式（SSE）
- server/src/core/provider.ts：provider 调用
- web/src/api.ts：前端请求 + SSE 解析
- web/src/App.tsx：UI + 增量渲染

