import type { ChatMessage, ChatToolCall } from '../types/chat.js';

const MAX_TOOL_ARGUMENT_LENGTH = 2000;
const MAX_TOOL_CALLS_PER_TURN = 4;
const MAX_EXPRESSION_LENGTH = 200;
const MAX_SEARCH_QUERY_LENGTH = 300;

export interface ToolExecutionResult {
  toolCall: ChatToolCall;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  providerMessage: ChatMessage;
  displayMessages: ChatMessage[];
}

export interface ToolExecutionBatchResult {
  executions: ToolExecutionResult[];
  providerMessages: ChatMessage[];
  displayMessages: ChatMessage[];
}

function parseToolArguments(rawArguments: string | undefined): Record<string, unknown> {
  if (!rawArguments) {
    return {};
  }

  if (rawArguments.length > MAX_TOOL_ARGUMENT_LENGTH) {
    throw new Error(`Tool arguments exceed max length of ${MAX_TOOL_ARGUMENT_LENGTH}`);
  }

  try {
    const parsed = JSON.parse(rawArguments);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error('tool arguments must be a JSON object');
  } catch (error: any) {
    throw new Error(`Invalid tool arguments: ${error?.message ?? 'unknown parse error'}`);
  }
}

function normalizeToolCall(toolCall: ChatToolCall): ChatToolCall {
  return {
    id: toolCall.id || `tool_call_${Math.random().toString(36).slice(2, 8)}`,
    type: 'function',
    function: {
      name: toolCall.function?.name || 'unknown_tool',
      arguments: toolCall.function?.arguments || '{}'
    }
  };
}

function formatArgs(args: Record<string, unknown>) {
  const entries = Object.entries(args);
  if (entries.length === 0) {
    return '{}';
  }

  return JSON.stringify(args);
}

function formatToolResult(name: string, output: Record<string, unknown>) {
  switch (name) {
    case 'get_time':
      return `Tool result (${name}): ${String(output.local_time ?? output.timestamp ?? '')} (${String(output.timezone ?? 'UTC')})`;
    case 'calculate':
      return `Tool result (${name}): ${String(output.expression ?? '')} = ${String(output.result ?? '')}`;
    case 'web_search':
      return `Tool result (${name}): ${String(output.summary ?? '')}`;
    default:
      return `Tool result (${name}): ${JSON.stringify(output)}`;
  }
}

function ensureTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    throw new Error(`Invalid timezone: ${timezone}`);
  }
}

function formatDateTime(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  return formatter.format(date).replace(' ', 'T');
}

function tokenize(expression: string) {
  const compact = expression.replace(/\s+/g, '');
  if (!compact) {
    throw new Error('Expression is required');
  }

  const tokens = compact.match(/\d+(?:\.\d+)?|[()+\-*/]/g);
  if (!tokens || tokens.join('') !== compact) {
    throw new Error('Expression contains unsupported characters');
  }

  return tokens;
}

function evaluateExpression(expression: string): number {
  const tokens = tokenize(expression);
  let index = 0;

  function peek() {
    return tokens[index];
  }

  function consume(expected?: string) {
    const token = tokens[index];
    if (!token) {
      throw new Error('Unexpected end of expression');
    }
    if (expected && token !== expected) {
      throw new Error(`Expected ${expected} but received ${token}`);
    }
    index += 1;
    return token;
  }

  function parsePrimary(): number {
    const token = peek();
    if (!token) {
      throw new Error('Unexpected end of expression');
    }

    if (token === '(') {
      consume('(');
      const value = parseExpression();
      consume(')');
      return value;
    }

    if (token === '+') {
      consume('+');
      return parsePrimary();
    }

    if (token === '-') {
      consume('-');
      return -parsePrimary();
    }

    consume();
    return Number(token);
  }

  function parseTerm(): number {
    let value = parsePrimary();

    while (peek() === '*' || peek() === '/') {
      const operator = consume();
      const rhs = parsePrimary();
      if (operator === '*') {
        value *= rhs;
      } else {
        if (rhs === 0) {
          throw new Error('Division by zero is not allowed');
        }
        value /= rhs;
      }
    }

    return value;
  }

  function parseExpression(): number {
    let value = parseTerm();

    while (peek() === '+' || peek() === '-') {
      const operator = consume();
      const rhs = parseTerm();
      if (operator === '+') {
        value += rhs;
      } else {
        value -= rhs;
      }
    }

    return value;
  }

  const result = parseExpression();
  if (index !== tokens.length) {
    throw new Error(`Unexpected token: ${tokens[index]}`);
  }
  return Number(result.toFixed(12));
}

async function getTime(args: Record<string, unknown>) {
  const timezone = ensureTimezone(typeof args.timezone === 'string' ? args.timezone : 'UTC');
  const now = new Date();
  return {
    timezone,
    local_time: formatDateTime(now, timezone),
    timestamp: now.toISOString()
  };
}

async function calculate(args: Record<string, unknown>) {
  const expression = typeof args.expression === 'string' ? args.expression : '';
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`Expression exceeds max length of ${MAX_EXPRESSION_LENGTH}`);
  }
  return {
    expression,
    result: evaluateExpression(expression)
  };
}

async function webSearch(args: Record<string, unknown>) {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    throw new Error('query is required');
  }
  if (query.length > MAX_SEARCH_QUERY_LENGTH) {
    throw new Error(`query exceeds max length of ${MAX_SEARCH_QUERY_LENGTH}`);
  }

  return {
    query,
    provider: 'mock-search',
    results: [
      {
        title: `${query} — official docs`,
        url: `https://example.com/search?q=${encodeURIComponent(query)}&result=1`,
        snippet: `Official documentation and product pages related to ${query}.`
      },
      {
        title: `${query} — tutorials`,
        url: `https://example.com/search?q=${encodeURIComponent(query)}&result=2`,
        snippet: `Hands-on tutorials, examples, and walkthroughs for ${query}.`
      }
    ],
    summary: `Mock search found 2 results for "${query}".`
  };
}

async function runTool(name: string, args: Record<string, unknown>) {
  switch (name) {
    case 'get_time':
      return getTime(args);
    case 'calculate':
      return calculate(args);
    case 'web_search':
      return webSearch(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function executeToolCall(toolCall: ChatToolCall): Promise<ToolExecutionResult> {
  const normalizedCall = normalizeToolCall(toolCall);
  const args = parseToolArguments(normalizedCall.function.arguments);
  const output = await runTool(normalizedCall.function.name, args);

  return {
    toolCall: normalizedCall,
    input: args,
    output,
    providerMessage: {
      role: 'tool',
      content: JSON.stringify(output),
      tool_call_id: normalizedCall.id
    },
    displayMessages: [
      {
        role: 'assistant',
        content: `Calling ${normalizedCall.function.name} with ${formatArgs(args)}`
      },
      {
        role: 'tool',
        content: formatToolResult(normalizedCall.function.name, output)
      }
    ]
  };
}

export async function executeToolCalls(toolCalls: ChatToolCall[]): Promise<ToolExecutionBatchResult> {
  if (toolCalls.length > MAX_TOOL_CALLS_PER_TURN) {
    throw new Error(`Too many tool calls requested in one turn (max ${MAX_TOOL_CALLS_PER_TURN})`);
  }

  const executions = await Promise.all(toolCalls.map((toolCall) => executeToolCall(toolCall)));

  return {
    executions,
    providerMessages: executions.map((execution) => execution.providerMessage),
    displayMessages: executions.flatMap((execution) => execution.displayMessages)
  };
}
