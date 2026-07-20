import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAgentSystemPrompt,
  EXTERNAL_TOOLS_UNAVAILABLE_CONTEXT,
  externalToolUnavailableResult,
} from './agent-policy';

test('keeps normal conversation available when external tools are unavailable', () => {
  const prompt = buildAgentSystemPrompt(false);

  assert.match(prompt, /继续正常处理不依赖外部能力的对话/u);
  assert.match(prompt, /不得编造结果/u);
  assert.doesNotMatch(prompt, /家政|服务商|订单|MCP/u);
});

test('does not add unavailable context when tools are available', () => {
  const prompt = buildAgentSystemPrompt(true);

  assert.equal(prompt.includes(EXTERNAL_TOOLS_UNAVAILABLE_CONTEXT), false);
  assert.match(prompt, /成功工具结果/u);
});

test('represents an unavailable tool as a normal unsuccessful tool result', () => {
  assert.deepEqual(externalToolUnavailableResult(), {
    ok: false,
    error: 'EXTERNAL_CAPABILITY_UNAVAILABLE',
    message: 'The requested external capability is temporarily unavailable. Do not claim that it succeeded.',
  });
});
