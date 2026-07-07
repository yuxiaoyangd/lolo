import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';
import type { ChatMessage } from '../types';

interface Props {
  timeline: ChatMessage[];
  isStreaming: boolean;
}

export default function ChatWindow({ timeline, isStreaming }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [timeline]);

  return (
    <div className="chat-window">
      {timeline.length === 0 && (
        <div className="chat-empty">
          <div className="chat-empty-icon">🤖</div>
          <h2>lolo</h2>
          <p>你好，我是lolo</p>
        </div>
      )}
      {timeline.map((item) => (
        <MessageBubble
          key={item.id}
          role={item.role}
          content={item.content}
          isStreaming={item.role === 'assistant' && isStreaming && item === timeline[timeline.length - 1]}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
