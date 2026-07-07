import { useState, type FormEvent } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue('');
  }

  return (
    <form className="chat-input" onSubmit={handleSubmit}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={disabled ? '回复中...' : '输入消息...'}
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || !value.trim()}>
        发送
      </button>
    </form>
  );
}
