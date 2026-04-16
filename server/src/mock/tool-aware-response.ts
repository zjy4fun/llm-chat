import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export interface MockMessage {
  role: string;
  content?: string | null;
  tool_call_id?: string;
}

export interface MockToolCallPlan {
  id: string;
  name: 'get_time' | 'calculate' | 'web_search';
  args: Record<string, string>;
}

export interface MockResponsePlan {
  toolCall?: MockToolCallPlan;
  text?: string;
}

const DEFAULT_RESPONSE =
  '我是 Mock LLM Server 的模拟回复。你可以尝试发送包含以下关键词的消息来获取不同的回复：hello、你好、test、code、long、time。';

const MOCK_RESPONSES: Record<string, string> = {
  time: '现在是北京时间 2026年4月10日 14:30:00。有什么我可以帮你的吗？',
  hello: '你好！我是一个模拟的 AI 助手，正在以流式方式返回文本。有什么我可以帮助你的吗？',
  你好: '你好呀！很高兴见到你。我是 Mock LLM Server，专门用于开发测试。请随便问我点什么吧！',
  test: 'This is a **test response** from the mock LLM server.\n\n- Item 1\n- Item 2\n- Item 3\n\nEverything is working correctly! 🎉',
  code: '好的，下面是一个简单的 TypeScript 示例：\n\n```typescript\nfunction greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n\nconsole.log(greet("World"));\n```\n\n这个函数接收一个字符串参数并返回问候语。',
  long: '这是一段较长的模拟回复，用于测试长文本的流式输出效果。\n\n在软件开发过程中，我们经常需要模拟各种外部服务的行为，以便在不依赖真实服务的情况下进行开发和测试。Mock Server 就是这样一种工具，它可以模拟真实 API 的响应，让开发者能够专注于业务逻辑的实现。\n\n使用 Mock Server 的好处包括：\n\n1. **降低开发成本**：不需要消耗真实的 API 调用额度\n2. **提高开发效率**：无需等待网络请求，响应速度更快\n3. **可控的测试环境**：可以模拟各种边界情况和错误场景\n4. **离线开发**：即使没有网络也能正常开发\n\n希望这个 Mock Server 能帮助你更高效地进行开发！'
};

function latestUserContent(messages: MockMessage[]) {
  return messages.filter((message) => message.role === 'user').at(-1)?.content?.toLowerCase() ?? '';
}

function pickFallbackResponse(messages: MockMessage[]): string {
  const content = latestUserContent(messages);
  for (const [keyword, response] of Object.entries(MOCK_RESPONSES)) {
    if (content.includes(keyword)) return response;
  }
  return DEFAULT_RESPONSE;
}

function hasToolSupport(tools?: ChatCompletionTool[]) {
  return Array.isArray(tools) && tools.length > 0;
}

function parseToolPayload(content: string | null | undefined) {
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function latestToolPayload(messages: MockMessage[]) {
  const toolMessage = [...messages].reverse().find((message) => message.role === 'tool');
  return parseToolPayload(toolMessage?.content);
}

function plannedToolCall(messages: MockMessage[]): MockToolCallPlan | undefined {
  const content = latestUserContent(messages);

  if (/time|时间|timezone|上海|shanghai/.test(content)) {
    return {
      id: 'call_time_mock_1',
      name: 'get_time',
      args: { timezone: /上海|shanghai/.test(content) ? 'Asia/Shanghai' : 'UTC' }
    };
  }

  if (/calculate|math|算|\d+[+\-*/()\d\s]+/.test(content)) {
    const expressionMatch = content.match(/([\d\s()+\-*/.]{3,})/);
    return {
      id: 'call_calc_mock_1',
      name: 'calculate',
      args: { expression: expressionMatch?.[1]?.replace(/\s+/g, '') || '2+2' }
    };
  }

  if (/search|搜索|搜一搜|百度|baidu/.test(content)) {
    const query = content.replace(/.*?(search|搜索|搜一搜)/, '').trim() || content;
    return {
      id: 'call_search_mock_1',
      name: 'web_search',
      args: { query }
    };
  }

  return undefined;
}

function finalTextFromTool(messages: MockMessage[]) {
  const payload = latestToolPayload(messages);
  if (!payload) {
    return undefined;
  }

  if (typeof payload.local_time === 'string') {
    return `根据工具结果，当前 ${String(payload.timezone ?? 'UTC')} 时间是 ${payload.local_time}。`;
  }

  if (payload.expression && payload.result !== undefined) {
    return `根据工具计算结果，${String(payload.expression)} = ${String(payload.result)}。`;
  }

  if (typeof payload.summary === 'string') {
    return `根据搜索工具结果：${payload.summary}`;
  }

  return undefined;
}

export function buildMockResponsePlan(messages: MockMessage[], tools?: ChatCompletionTool[]): MockResponsePlan {
  if (!hasToolSupport(tools)) {
    return { text: pickFallbackResponse(messages) };
  }

  const finalText = finalTextFromTool(messages);
  if (finalText) {
    return { text: finalText };
  }

  const toolCall = plannedToolCall(messages);
  if (toolCall) {
    return { toolCall };
  }

  return { text: pickFallbackResponse(messages) };
}
