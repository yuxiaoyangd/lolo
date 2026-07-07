export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolCallEntry {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  success?: boolean;
}

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; content: string; success: boolean }
  | { type: 'error'; content: string }
  | { type: 'done' };
