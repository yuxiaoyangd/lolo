import { useState, useCallback } from 'react';
import ChatWindow from './components/ChatWindow';
import ChatInput from './components/ChatInput';
import { streamChat } from './api';
import type { ChatMessage } from './types';

let nextId = 1;
function uid(): string {
  return `id-${nextId++}`;
}

export default function App() {
  const [timeline, setTimeline] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const send = useCallback(async (text: string) => {
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: text };
    const updatedTimeline = [...timeline, userMsg];
    setTimeline(updatedTimeline);
    setIsStreaming(true);

    const apiMessages = updatedTimeline.map((m) => ({ role: m.role, content: m.content }));

    let assistantId = '';
    let assistantContent = '';

    try {
      const stream = streamChat(apiMessages);

      for await (const event of stream) {
        switch (event.type) {
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
                item.id === assistantId
                  ? { ...item, content: assistantContent }
                  : item
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
                item.id === assistantId
                  ? { ...item, content: assistantContent }
                  : item
              )
            );
            break;
          }
          case 'done':
            setIsStreaming(false);
            break;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTimeline((prev) => [
        ...prev,
        { id: uid(), role: 'assistant', content: `连接失败: ${msg}` },
      ]);
      setIsStreaming(false);
    }
  }, [timeline]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>lolo</h1>
      </header>
      <main className="app-main">
        <ChatWindow timeline={timeline} isStreaming={isStreaming} />
      </main>
      <footer className="app-footer">
        <ChatInput onSend={send} disabled={isStreaming} />
      </footer>
    </div>
  );
}
