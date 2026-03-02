import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { chatRouter } from './routes/chat.js';
import { chatStreamRouter } from './routes/chat-stream.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'llm-chat-server' });
});

app.use('/chat', chatRouter);
app.use('/chat/stream', chatStreamRouter);

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`llm-chat-server listening on http://localhost:${port}`);
});
