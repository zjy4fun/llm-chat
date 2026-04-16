import { describe, expect, it } from 'vitest';
import { TOOL_DEFINITIONS } from './prompt.js';
import { executeToolCall, executeToolCalls } from './tool-executor.js';

describe('tool executor', () => {
  it('exposes every implemented tool to the model prompt', () => {
    const toolNames = TOOL_DEFINITIONS.map((definition) => definition.function.name);
    expect(toolNames).toEqual(expect.arrayContaining(['get_time', 'calculate', 'web_search']));
  });

  it('calculates arithmetic expressions without using eval', async () => {
    const result = await executeToolCall({
      id: 'call_calc',
      type: 'function',
      function: {
        name: 'calculate',
        arguments: '{"expression":"(2+3)*4-5/5"}'
      }
    });

    expect(result.output.result).toBe(19);
    expect(result.providerMessage.content).toContain('19');
    expect(result.displayMessages[0]?.content).toContain('calculate');
  });

  it('rejects oversized arithmetic expressions', async () => {
    await expect(
      executeToolCall({
        id: 'call_big_calc',
        type: 'function',
        function: {
          name: 'calculate',
          arguments: JSON.stringify({ expression: '1+'.repeat(250) + '1' })
        }
      })
    ).rejects.toThrow('Expression exceeds max length');
  });

  it('executes multiple tool calls and keeps provider/tool display messages aligned', async () => {
    const execution = await executeToolCalls([
      {
        id: 'call_time',
        type: 'function',
        function: {
          name: 'get_time',
          arguments: '{"timezone":"Asia/Shanghai"}'
        }
      },
      {
        id: 'call_search',
        type: 'function',
        function: {
          name: 'web_search',
          arguments: '{"query":"OpenAI tool calls"}'
        }
      }
    ]);

    expect(execution.providerMessages).toHaveLength(2);
    expect(execution.displayMessages).toHaveLength(4);
    expect(execution.displayMessages[0]?.content).toContain('get_time');
    expect(execution.displayMessages[1]?.content).toContain('Asia/Shanghai');
    expect(execution.displayMessages[3]?.content).toContain('OpenAI tool calls');
  });
});
