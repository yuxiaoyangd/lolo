export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'error'; content: string }
  | { type: 'done' };
