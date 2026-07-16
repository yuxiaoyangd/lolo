import type { StreamEvent } from './types';

export async function* streamChat(
  messages: { role: string; content: string | null }[]
): AsyncGenerator<StreamEvent> {
  const response = await fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });

  yield* readEventStream(response);
}

export async function* streamApproval(approvalId: string): AsyncGenerator<StreamEvent> {
  const response = await fetch(`/approvals/${encodeURIComponent(approvalId)}/confirm`, {
    method: 'POST',
  });
  yield* readEventStream(response);
}

export async function rejectApproval(approvalId: string): Promise<void> {
  const response = await fetch(`/approvals/${encodeURIComponent(approvalId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
}

async function* readEventStream(response: Response): AsyncGenerator<StreamEvent> {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        yield JSON.parse(line.slice(6)) as StreamEvent;
      }
    }
  }
}
