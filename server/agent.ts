import { randomUUID } from 'node:crypto';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources/chat/completions';
import { client, MODEL } from './llm';
import { callMcpTool, listMcpTools, type ModelTool } from './mcp';
import {
  buildAgentSystemPrompt,
  EXTERNAL_TOOLS_UNAVAILABLE_CONTEXT,
  externalToolUnavailableResult,
} from './agent-policy';
import {
  formatApprovalSuccess,
  getApprovalRequest,
  getToolFailureMessage,
} from './tool-approval';
import { buildCurrentTimeContext } from './time-context';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const MAX_TOOL_ROUNDS = 6;
const APPROVAL_TTL_MS = 15 * 60 * 1000;
const DEBUG_LLM_REQUESTS = /^(1|true|yes|on)$/iu.test(process.env.LOLO_DEBUG_LLM || '');

interface PendingApproval {
  toolName: string;
  args: Record<string, unknown>;
  expiresAt: number;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

interface LlmRequest {
  model: string;
  messages: Array<Record<string, unknown>>;
  stream: true;
  tools?: ModelTool[];
  tool_choice?: 'auto';
}

const pendingApprovals = new Map<string, PendingApproval>();

async function retryLLM<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 429 && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`[lolo] ${label} 限流 (429)，${delay}ms 后重试 (${attempt + 1}/${MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error(`[lolo] ${label} 重试耗尽`);
}

function sse(type: string, data: Record<string, unknown> = {}) {
  return `data: ${JSON.stringify({ type, ...data })}\n\n`;
}

export async function* chat(
  messages: { role: string; content: string | null }[]
): AsyncGenerator<string> {
  let tools: ModelTool[] = [];
  let mcpConnected = false;
  try {
    tools = await listMcpTools();
    mcpConnected = true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[lolo] MCP unavailable, continuing without external tools: ${message}`);
    yield sse('mcp_status', { connected: false });
  }

  if (tools.length === 0) {
    console.warn('[lolo] No external tools available; continuing in conversation-only mode.');
    if (mcpConnected) yield sse('mcp_status', { connected: true, toolCount: 0 });
  } else {
    yield sse('mcp_status', { connected: true, toolCount: tools.length });
  }

  const fullMessages: Array<Record<string, unknown>> = [
    {
      role: 'system',
      content: `${buildAgentSystemPrompt(tools.length > 0)}\n\n${buildCurrentTimeContext()}`,
    },
    ...messages,
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const request = buildLlmRequest(fullMessages, tools);
    if (DEBUG_LLM_REQUESTS) {
      yield sse('llm_request_debug', {
        label: `tool_round_${round + 1}`,
        request,
      });
    }
    const stream = await createModelStream(request);
    const toolCalls = new Map<number, ToolCallAccumulator>();
    let assistantContent = '';

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        assistantContent += delta.content;
        yield sse('text', { content: delta.content });
      }

      for (const toolCall of delta.tool_calls || []) {
        const current = toolCalls.get(toolCall.index) || { id: '', name: '', arguments: '' };
        if (toolCall.id) current.id = toolCall.id;
        if (toolCall.function?.name) current.name += toolCall.function.name;
        if (toolCall.function?.arguments) current.arguments += toolCall.function.arguments;
        toolCalls.set(toolCall.index, current);
      }
    }

    if (toolCalls.size === 0) {
      yield sse('done');
      return;
    }

    const calls = [...toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call], index) => ({
        ...call,
        id: call.id || `tool_${round}_${index}`,
      }));

    fullMessages.push({
      role: 'assistant',
      content: assistantContent || null,
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    let resultApproval: {
      approvalId: string;
      action: string;
      message: string;
    } | null = null;

    let externalToolsAvailable = true;
    let externalToolFailure = false;

    for (const call of calls) {
      const args = parseToolArguments(call.arguments);
      if (!args) {
        fullMessages.push(toolMessage(call.id, { ok: false, error: 'INVALID_TOOL_ARGUMENTS' }));
        continue;
      }

      if (!externalToolsAvailable) {
        fullMessages.push(toolMessage(call.id, externalToolUnavailableResult()));
        continue;
      }

      const toolDefinition = tools.find((tool) => tool.function.name === call.name);
      if (toolDefinition?.annotations?.destructiveHint === true) {
        const approvalId = createApproval(call.name, args);
        fullMessages.push(
          toolMessage(call.id, {
            ok: false,
            error: 'USER_APPROVAL_REQUIRED',
            approvalId,
          })
        );
        fullMessages.push({
          role: 'system',
          content:
            '危险操作已被代码拦截。请清楚展示即将执行的操作、关键参数和可能影响，并要求用户使用界面按钮确认。',
        });
        yield* streamWithoutTools(fullMessages, 'destructive_approval_summary');
        yield sse('approval_required', {
          approvalId,
          action: call.name,
          message: `确认执行 ${toolDefinition.function.description}？`,
        });
        yield sse('done');
        return;
      }

      let result: Record<string, unknown>;
      try {
        result = await callMcpTool(call.name, args);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[lolo] External tool call failed; continuing conversation: ${message}`);
        externalToolsAvailable = false;
        externalToolFailure = true;
        tools = [];
        result = externalToolUnavailableResult();
        yield sse('mcp_status', { connected: false });
      }
      fullMessages.push(toolMessage(call.id, result));

      const approvalRequest = getApprovalRequest(result);
      if (approvalRequest) {
        if (resultApproval) {
          yield sse('error', { content: '一次只能处理一个待确认操作，请重新发起。' });
          yield sse('done');
          return;
        }
        resultApproval = {
          approvalId: createApproval(approvalRequest.toolName, approvalRequest.args),
          action: approvalRequest.toolName,
          message: approvalRequest.message,
        };
      }
    }

    if (externalToolFailure) {
      fullMessages.push({
        role: 'system',
        content: EXTERNAL_TOOLS_UNAVAILABLE_CONTEXT,
      });
    }

    if (resultApproval) {
      fullMessages.push({
        role: 'system',
        content:
          '工具返回了需要用户显式确认的后续操作。请准确展示结构化结果中的关键信息，并告知用户必须点击界面确认按钮后才会执行。不要自行调用后续工具。',
      });
      yield* streamWithoutTools(fullMessages, 'server_confirmation_summary');
      yield sse('approval_required', {
        approvalId: resultApproval.approvalId,
        action: resultApproval.action,
        message: resultApproval.message,
      });
      yield sse('done');
      return;
    }
  }

  yield sse('error', { content: '工具调用轮次过多，已停止执行。' });
  yield sse('done');
}

export async function* confirmApproval(approvalId: string): AsyncGenerator<string> {
  const approval = takeApproval(approvalId);
  if (!approval) {
    yield sse('error', { content: '确认请求不存在或已过期，请重新发起操作。' });
    yield sse('done');
    return;
  }

  let result: Record<string, unknown>;
  try {
    result = await callMcpTool(approval.toolName, approval.args);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[lolo] Approved external operation could not be executed: ${message}`);
    yield sse('mcp_status', { connected: false });
    yield sse('error', { content: '暂时无法完成这个操作，请稍后再试。' });
    yield sse('done');
    return;
  }
  if (result.ok !== true) {
    yield sse('error', {
      content: getToolFailureMessage(approval.toolName, result),
    });
    yield sse('done');
    return;
  }

  yield sse('text', {
    content: formatApprovalSuccess(approval.toolName, result),
  });
  yield sse('done');
}

export function rejectApproval(approvalId: string): boolean {
  cleanupExpiredApprovals();
  return pendingApprovals.delete(approvalId);
}

function buildLlmRequest(
  messages: Array<Record<string, unknown>>,
  tools: ModelTool[]
): LlmRequest {
  return {
    model: MODEL,
    messages,
    ...(tools.length ? { tools, tool_choice: 'auto' as const } : {}),
    stream: true,
  };
}

async function createModelStream(request: LlmRequest) {
  return retryLLM(
    () =>
      client.chat.completions.create(
        request as unknown as ChatCompletionCreateParamsStreaming
      ),
    'LLM'
  );
}

async function* streamWithoutTools(
  messages: Array<Record<string, unknown>>,
  label: string
): AsyncGenerator<string> {
  const request = buildLlmRequest(messages, []);
  if (DEBUG_LLM_REQUESTS) {
    yield sse('llm_request_debug', { label, request });
  }
  const stream = await createModelStream(request);
  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) yield sse('text', { content });
  }
}

function toolMessage(toolCallId: string, result: Record<string, unknown>) {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify(result),
  };
}

function parseToolArguments(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value || '{}');
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function createApproval(toolName: string, args: Record<string, unknown>): string {
  cleanupExpiredApprovals();
  const approvalId = randomUUID();
  pendingApprovals.set(approvalId, {
    toolName,
    args,
    expiresAt: Date.now() + APPROVAL_TTL_MS,
  });
  return approvalId;
}

function takeApproval(approvalId: string): PendingApproval | null {
  cleanupExpiredApprovals();
  const approval = pendingApprovals.get(approvalId) || null;
  if (approval) pendingApprovals.delete(approvalId);
  return approval;
}

function cleanupExpiredApprovals(): void {
  const now = Date.now();
  for (const [id, approval] of pendingApprovals) {
    if (approval.expiresAt <= now) pendingApprovals.delete(id);
  }
}
