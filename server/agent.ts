import { client, MODEL } from './llm';
import { fetchTools, execute, type ToolDef } from './nodexa';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const SYSTEM_PROMPT = `你是 lolo，一个通用 AI Agent。可以陪你聊天、解答问题，也可以对接现实服务。

所有服务内容都是隐藏的，不要主动和用户提起服务内容。请仅在用户明确表达相关意图时使用对应工具，否则正常对话即可。`;

let cachedTools: ToolDef[] | null = null;

async function getTools(): Promise<ToolDef[]> {
  if (!cachedTools) {
    cachedTools = await fetchTools();
    console.log(`[lolo] 已加载 ${cachedTools.length} 个工具`);
  }
  return cachedTools;
}

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
  const tools = await getTools();

  const fullMessages: Array<Record<string, unknown>> = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages,
  ];

  yield sse('debug', { messages: fullMessages, tools });

  const stream1 = await retryLLM(
    () =>
      client.chat.completions.create({
        model: MODEL,
        messages: fullMessages as never,
        ...(tools.length > 0 ? { tools: tools as never, tool_choice: 'auto' as const } : {}),
        stream: true,
      }),
    'LLM'
  );

  const toolCallAcc = new Map<number, { id: string; name: string; arguments: string }>();

  for await (const chunk of stream1) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      yield sse('text', { content: delta.content });
    }

    if (delta.tool_calls) {
      for (const tcDelta of delta.tool_calls) {
        const idx = tcDelta.index;
        if (!toolCallAcc.has(idx)) {
          toolCallAcc.set(idx, { id: '', name: '', arguments: '' });
        }
        const acc = toolCallAcc.get(idx)!;
        if (tcDelta.id) acc.id = tcDelta.id;
        if (tcDelta.function) {
          if (tcDelta.function.name) acc.name += tcDelta.function.name;
          if (tcDelta.function.arguments) acc.arguments += tcDelta.function.arguments;
        }
      }
    }
  }

  if (toolCallAcc.size === 0) {
    yield sse('done');
    return;
  }

  const sortedIndices = [...toolCallAcc.keys()].sort((a, b) => a - b);

  for (const idx of sortedIndices) {
    const acc = toolCallAcc.get(idx)!;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(acc.arguments);
    } catch {
      /* ignore */
    }

    fullMessages.push({
      role: 'assistant',
      tool_calls: [
        {
          id: acc.id,
          type: 'function',
          function: { name: acc.name, arguments: acc.arguments },
        },
      ],
      content: null,
    });

    try {
      const result = await execute(acc.name, args);
      const content = typeof result === 'string' ? result : JSON.stringify(result);
      fullMessages.push({
        role: 'tool',
        tool_call_id: acc.id,
        content,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      yield sse('error', { content: `服务调用失败: ${msg}` });
      fullMessages.push({
        role: 'tool',
        tool_call_id: acc.id,
        content: JSON.stringify({ error: msg }),
      });
    }
  }

  const stream2 = await retryLLM(
    () =>
      client.chat.completions.create({
        model: MODEL,
        messages: fullMessages as never,
        stream: true,
      }),
    'LLM总结'
  );

  for await (const chunk of stream2) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) {
      yield sse('text', { content: delta.content });
    }
  }

  yield sse('done');
}
