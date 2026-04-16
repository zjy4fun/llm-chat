import { describe, expect, it } from 'vitest';
import { buildMockResponsePlan } from './tool-aware-response.js';

describe('buildMockResponsePlan', () => {
  it('plans a web search tool call when tools are enabled and the user asks to search', () => {
    const plan = buildMockResponsePlan(
      [{ role: 'user', content: '帮我搜一搜 baidu' }],
      [{ type: 'function', function: { name: 'web_search', description: 'search', parameters: { type: 'object' } } }]
    );

    expect(plan.toolCall).toMatchObject({
      name: 'web_search',
      args: { query: 'baidu' }
    });
    expect(plan.text).toBeUndefined();
  });

  it('returns a post-tool final answer after a time tool result is present', () => {
    const plan = buildMockResponsePlan(
      [
        { role: 'user', content: '现在上海时间是多少？' },
        { role: 'assistant', content: '', tool_call_id: 'call_time_mock_1' },
        { role: 'tool', content: JSON.stringify({ timezone: 'Asia/Shanghai', local_time: '2026-04-16T12:00:00' }) }
      ],
      [{ type: 'function', function: { name: 'get_time', description: 'time', parameters: { type: 'object' } } }]
    );

    expect(plan.text).toContain('Asia/Shanghai');
    expect(plan.text).toContain('2026-04-16T12:00:00');
    expect(plan.toolCall).toBeUndefined();
  });

  it('falls back to the plain mock response when tools are not enabled', () => {
    const plan = buildMockResponsePlan([{ role: 'user', content: '帮我搜一搜 baidu' }], undefined);

    expect(plan.toolCall).toBeUndefined();
    expect(plan.text).toContain('Mock LLM Server');
  });
});
