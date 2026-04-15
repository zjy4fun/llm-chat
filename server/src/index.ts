import 'dotenv/config';
import { createApp } from './app.js';

const app = createApp();
const port = Number(process.env.PORT || 8787);

app.listen(port, () => {
  console.log(`llm-chat-server listening on http://localhost:${port}`);
});
