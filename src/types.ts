export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'error'; content: string }
  | { type: 'approval_required'; approvalId: string; action: string; message: string }
  | { type: 'done' };
