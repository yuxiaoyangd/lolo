import { client, MODEL } from './llm';
import {
  fetchIntents,
  fetchPlugin,
  execute,
  buildParamSchema,
  type IntentsResponse,
  type PluginDef,
} from './nodexa';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const SYSTEM_PROMPT = `你是 lolo，一个通用 AI Agent。

当用户的需求涉及出行、购物、线下服务时，通过已提供的工具选择对应的服务。选择后将获得该服务的具体参数信息。

其他情况正常对话即可。`;

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

function buildIntentTools(intentsData: IntentsResponse) {
  return intentsData.intents.map((item) => ({
    type: 'function' as const,
    function: {
      name: item.intent,
      description: `${item.name} - ${item.description || ''}`,
      parameters: { type: 'object' as const, properties: {} },
    },
  }));
}

function buildExecuteTool(plugin: PluginDef) {
  return {
    type: 'function' as const,
    function: {
      name: `execute_${plugin.intent}`,
      description: `调用 ${plugin.name}`,
      parameters: buildParamSchema(plugin.params || {}),
    },
  };
}

function pluginToText(plugin: PluginDef): string {
  const params = plugin.params || {};
  const fields = Object.entries(params)
    .map(([name, field]) => {
      const req = field.required ? '（必需）' : '（可选）';
      const opts = field.options ? `值: ${field.options.join('/')}` : field.type;
      return `  - ${name}: ${opts} ${req} ${field.prompt || ''}`;
    })
    .join('\n');
  return `${plugin.name} (${plugin.intent}) 的参数:\n${fields}`;
}

class ToolAccum {
  id = '';
  name = '';
  arguments = '';
}

export async function* chat(
  messages: { role: string; content: string | null }[]
): AsyncGenerator<string> {
  const intentsData = await fetchIntents();
  const intentTools = buildIntentTools(intentsData);

  const fullMessages: Array<Record<string, unknown>> = [
    {
      role: 'system',
      content: `${SYSTEM_PROMPT}\n\n${intentsData.instructions}`,
    },
    ...messages,
  ];

  const stream1 = await retryLLM(
    () =>
      client.chat.completions.create({
        model: MODEL,
        messages: fullMessages as never,
        tools: intentTools as never,
        tool_choice: 'auto' as const,
        stream: true,
      }),
    'LLM意图判断'
  );

  const toolAccums = new Map<number, ToolAccum>();

  for await (const chunk of stream1) {
    const delta = chunk.choices[0]?.delta;
    if (!delta) continue;

    if (delta.content) {
      yield sse('text', { content: delta.content });
    }

    if (delta.tool_calls) {
      for (const tcDelta of delta.tool_calls) {
        const idx = tcDelta.index;
        if (!toolAccums.has(idx)) {
          toolAccums.set(idx, new ToolAccum());
        }
        const acc = toolAccums.get(idx)!;
        if (tcDelta.id) acc.id = tcDelta.id;
        if (tcDelta.function) {
          if (tcDelta.function.name) acc.name += tcDelta.function.name;
          if (tcDelta.function.arguments) acc.arguments += tcDelta.function.arguments;
        }
      }
    }
  }

  if (toolAccums.size === 0) {
    yield sse('done');
    return;
  }

  const sortedIndices = [...toolAccums.keys()].sort((a, b) => a - b);

  for (const idx of sortedIndices) {
    const acc = toolAccums.get(idx)!;
    const selectedIntent = acc.name;

    yield sse('tool_call', { name: 'select_intent', arguments: { intent: selectedIntent } });

    const plugin = await fetchPlugin(selectedIntent);
    if (!plugin) {
      yield sse('error', { content: `未找到服务 "${selectedIntent}"` });
      continue;
    }

    const pluginInfo = pluginToText(plugin);
    yield sse('tool_result', { content: pluginInfo, success: true });

    const intentToolCallObj = {
      id: acc.id,
      type: 'function' as const,
      function: { name: acc.name, arguments: '{}' },
    };

    fullMessages.push({
      role: 'assistant',
      tool_calls: [intentToolCallObj],
      content: null,
    });
    fullMessages.push({
      role: 'tool',
      tool_call_id: acc.id,
      content: pluginInfo,
    });

    const executeTool = buildExecuteTool(plugin);

    const stream2 = await retryLLM(
      () =>
        client.chat.completions.create({
          model: MODEL,
          messages: fullMessages as never,
          tools: [executeTool] as never,
          tool_choice: 'auto' as const,
          stream: true,
        }),
      'LLM参数收集'
    );

    const paramAccums = new Map<number, ToolAccum>();

    for await (const chunk of stream2) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        yield sse('text', { content: delta.content });
      }

      if (delta.tool_calls) {
        for (const tcDelta of delta.tool_calls) {
          const pIdx = tcDelta.index;
          if (!paramAccums.has(pIdx)) {
            paramAccums.set(pIdx, new ToolAccum());
          }
          const pAcc = paramAccums.get(pIdx)!;
          if (tcDelta.id) pAcc.id = tcDelta.id;
          if (tcDelta.function) {
            if (tcDelta.function.name) pAcc.name += tcDelta.function.name;
            if (tcDelta.function.arguments) pAcc.arguments += tcDelta.function.arguments;
          }
        }
      }
    }

    if (paramAccums.size === 0) {
      yield sse('done');
      return;
    }

    for (const pIdx of [...paramAccums.keys()].sort((a, b) => a - b)) {
      const pAcc = paramAccums.get(pIdx)!;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(pAcc.arguments) as Record<string, unknown>;
      } catch {
        /* ignore */
      }

      yield sse('tool_call', { name: selectedIntent, arguments: args });

      const execToolCallObj = {
        id: pAcc.id,
        type: 'function' as const,
        function: { name: pAcc.name, arguments: pAcc.arguments },
      };

      try {
        const result = await execute(selectedIntent, args);
        yield sse('tool_result', {
          content: result.answer || '',
          success: result.success || false,
        });

        fullMessages.push({
          role: 'assistant',
          tool_calls: [execToolCallObj],
          content: null,
        });
        fullMessages.push({
          role: 'tool',
          tool_call_id: pAcc.id,
          content: JSON.stringify(result),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        yield sse('error', { content: msg });

        fullMessages.push({
          role: 'assistant',
          tool_calls: [execToolCallObj],
          content: null,
        });
        fullMessages.push({
          role: 'tool',
          tool_call_id: pAcc.id,
          content: JSON.stringify({ error: msg }),
        });
      }
    }
  }

  const streamFinal = await retryLLM(
    () =>
      client.chat.completions.create({
        model: MODEL,
        messages: fullMessages as never,
        stream: true,
      }),
    'LLM结果总结'
  );

  for await (const chunk of streamFinal) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) {
      yield sse('text', { content: delta.content });
    }
  }

  yield sse('done');
}
