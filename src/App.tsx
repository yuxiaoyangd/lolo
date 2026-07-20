import { useState, useCallback } from 'react';
import ChatWindow from './components/ChatWindow';
import ChatInput from './components/ChatInput';
import { rejectApproval, streamApproval, streamChat } from './api';
import type { ChatMessage, StreamEvent } from './types';

let nextId = 1;
function uid(): string {
  return `id-${nextId++}`;
}

export default function App() {
  const [timeline, setTimeline] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{
    approvalId: string;
    message: string;
  } | null>(null);

  const consumeStream = useCallback(async (stream: AsyncGenerator<StreamEvent>) => {
    let assistantId = '';
    let assistantContent = '';

    for await (const event of stream) {
      switch (event.type) {
        case 'mcp_status':
          console.info(
            `[lolo] MCP ${event.connected ? 'connected' : 'unavailable'}`,
            event.toolCount === undefined ? {} : { toolCount: event.toolCount }
          );
          break;
        case 'llm_request_debug':
          console.groupCollapsed(`[lolo] LLM request · ${event.label}`);
          console.log(JSON.stringify(event.request, null, 2));
          console.groupEnd();
          break;
        case 'text': {
          if (!assistantId) {
            assistantId = uid();
            setTimeline((prev) => [
              ...prev,
              { id: assistantId, role: 'assistant', content: '' },
            ]);
          }
          assistantContent += event.content;
          setTimeline((prev) =>
            prev.map((item) =>
              item.id === assistantId ? { ...item, content: assistantContent } : item
            )
          );
          break;
        }
        case 'error': {
          if (!assistantId) {
            assistantId = uid();
            setTimeline((prev) => [
              ...prev,
              { id: assistantId, role: 'assistant', content: '' },
            ]);
          }
          assistantContent += `\n\n⚠️ 错误: ${event.content}`;
          setTimeline((prev) =>
            prev.map((item) =>
              item.id === assistantId ? { ...item, content: assistantContent } : item
            )
          );
          break;
        }
        case 'approval_required':
          setPendingApproval({
            approvalId: event.approvalId,
            message: event.message,
          });
          break;
        case 'done':
          setIsStreaming(false);
          break;
      }
    }
  }, []);

  const send = useCallback(async (text: string) => {
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: text };
    const updatedTimeline = [...timeline, userMsg];
    setTimeline(updatedTimeline);
    setIsStreaming(true);

    const apiMessages = updatedTimeline.map((m) => ({ role: m.role, content: m.content }));

    try {
      await consumeStream(streamChat(apiMessages));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTimeline((prev) => [
        ...prev,
        { id: uid(), role: 'assistant', content: `连接失败: ${msg}` },
      ]);
      setIsStreaming(false);
    }
  }, [consumeStream, timeline]);

  const approve = useCallback(async () => {
    if (!pendingApproval) return;
    const { approvalId } = pendingApproval;
    setPendingApproval(null);
    setIsStreaming(true);
    try {
      await consumeStream(streamApproval(approvalId));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTimeline((prev) => [
        ...prev,
        { id: uid(), role: 'assistant', content: `确认失败: ${msg}` },
      ]);
      setIsStreaming(false);
    }
  }, [consumeStream, pendingApproval]);

  const reject = useCallback(async () => {
    if (!pendingApproval) return;
    const { approvalId } = pendingApproval;
    setPendingApproval(null);
    await rejectApproval(approvalId);
    setTimeline((prev) => [
      ...prev,
      { id: uid(), role: 'assistant', content: '已取消本次操作。' },
    ]);
  }, [pendingApproval]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>lolo</h1>
      </header>
      <main className="app-main">
        <ChatWindow timeline={timeline} isStreaming={isStreaming} />
      </main>
      <footer className="app-footer">
        {pendingApproval && (
          <div className="approval-panel">
            <span>{pendingApproval.message}</span>
            <button type="button" className="approval-confirm" onClick={approve}>
              确认执行
            </button>
            <button type="button" className="approval-reject" onClick={reject}>
              不执行
            </button>
          </div>
        )}
        <ChatInput onSend={send} disabled={isStreaming} />
      </footer>
    </div>
  );
}
