import { client, MODEL } from './llm';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

const SYSTEM_PROMPT = `你是 lolo，一个通用 AI 助手。请用中文回复用户的问题。`;

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
  const fullMessages: Array<Record<string, unknown>> = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages,
  ];

  const stream = await retryLLM(
    () =>
      client.chat.completions.create({
        model: MODEL,
        messages: fullMessages as never,
        stream: true,
      }),
    'LLM'
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.content) {
      yield sse('text', { content: delta.content });
    }
  }

  yield sse('done');
}
