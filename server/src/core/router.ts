import type { ChatMessage } from '../types/chat.js';

const MODEL_ALLOWLIST = {
  cheap: 'gpt-4o-mini',
  tool: 'gpt-4.1-mini',
  long: 'gpt-4.1'
} as const;

function estimateChars(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + m.content.length, 0);
}

export function chooseModel(params: {
  requestedModel: string;
  messages: ChatMessage[];
  needTools: boolean;
}): string {
  const { requestedModel, messages, needTools } = params;

  if (requestedModel && requestedModel !== 'auto') {
    return requestedModel;
  }

  if (needTools) {
    return MODEL_ALLOWLIST.tool;
  }

  const totalChars = estimateChars(messages);
  if (totalChars > 12000) {
    return MODEL_ALLOWLIST.long;
  }

  return MODEL_ALLOWLIST.cheap;
}
