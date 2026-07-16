import { randomUUID } from 'node:crypto';
import { client, MODEL } from './llm';
import { callMcpTool, listMcpTools, type ModelTool } from './mcp';
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

const SYSTEM_PROMPT = `你是 lolo，一个通用 AI Agent。请自然、准确、简洁地帮助用户。

你可以使用 MCP 工具完成现实服务请求。必须遵守：
1. 信息不足时先向用户追问，不得猜测地址、时间或服务要求。
2. 严格遵循 MCP 服务器提供的工具描述、输入 Schema、结构化结果和下一步建议。
3. 不得编造业务标识符；工具返回的引用值必须原样使用。
4. 对标注为 destructive 的工具必须等待界面用户审批，不得自行确认。
5. 金额字段以分为单位，向用户展示时换算为元。
6. 不得依赖模型自身记忆判断当前日期；必须使用本次请求附带的服务器时间基准。`;

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
  try {
    tools = await listMcpTools();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[lolo] MCP unavailable, continuing without tools: ${message}`);
  }

  const fullMessages: Array<Record<string, unknown>> = [
    {
      role: 'system',
      content: `${SYSTEM_PROMPT}\n\n${buildCurrentTimeContext()}`,
    },
    ...messages,
  ];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const stream = await createModelStream(fullMessages, tools);
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

    for (const call of calls) {
      const args = parseToolArguments(call.arguments);
      if (!args) {
        fullMessages.push(toolMessage(call.id, { ok: false, error: 'INVALID_TOOL_ARGUMENTS' }));
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
            '危险操作已被代码拦截。请清楚展示待执行操作的服务商、时间、地址、金额或取消原因，并要求用户使用界面按钮确认。',
        });
        yield* streamWithoutTools(fullMessages);
        yield sse('approval_required', {
          approvalId,
          action: call.name,
          message: `确认执行 ${toolDefinition.function.description}？`,
        });
        yield sse('done');
        return;
      }

      const result = await callMcpTool(call.name, args);
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

    if (resultApproval) {
      fullMessages.push({
        role: 'system',
        content:
          '工具返回了需要用户显式确认的后续操作。请准确展示结构化结果中的关键信息，并告知用户必须点击界面确认按钮后才会执行。不要自行调用后续工具。',
      });
      yield* streamWithoutTools(fullMessages);
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

  const result = await callMcpTool(approval.toolName, approval.args);
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

async function createModelStream(messages: Array<Record<string, unknown>>, tools: ModelTool[]) {
  return retryLLM(
    () =>
      client.chat.completions.create({
        model: MODEL,
        messages: messages as never,
        ...(tools.length ? { tools: tools as never, tool_choice: 'auto' as const } : {}),
        stream: true,
      }),
    'LLM'
  );
}

async function* streamWithoutTools(
  messages: Array<Record<string, unknown>>
): AsyncGenerator<string> {
  const stream = await createModelStream(messages, []);
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
