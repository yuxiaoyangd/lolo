interface Props {
  role: 'user' | 'assistant';
  content: string;
  isStreaming?: boolean;
}

export default function MessageBubble({ role, content, isStreaming }: Props) {
  return (
    <div className={`message-bubble ${role}`}>
      <div className="bubble-avatar">{role === 'user' ? '👤' : '🤖'}</div>
      <div className="bubble-content">
        {content || (isStreaming ? <span className="typing-cursor" /> : '...')}
      </div>
    </div>
  );
}
