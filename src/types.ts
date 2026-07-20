export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'error'; content: string }
  | { type: 'mcp_status'; connected: boolean; toolCount?: number }
  | {
      type: 'llm_request_debug';
      label: string;
      request: Record<string, unknown>;
    }
  | { type: 'approval_required'; approvalId: string; action: string; message: string }
  | { type: 'done' };
