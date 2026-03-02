interface LogInput {
  traceId: string;
  userId: string;
  sessionId: string;
  model: string;
  mode: 'stream' | 'non-stream';
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  errorCode?: string;
}

export function logChat(data: LogInput) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      type: 'chat_log',
      ...data
    })
  );
}
