type ToolResult = Record<string, unknown>;

export interface ToolApprovalRequest {
  toolName: string;
  args: Record<string, unknown>;
  message: string;
}

export function getApprovalRequest(result: ToolResult): ToolApprovalRequest | null {
  if (result.ok !== true) return null;

  const data = asRecord(result.data);
  const confirmation = asRecord(data?.confirmation);
  const args = asRecord(confirmation?.arguments);
  const toolName = confirmation?.toolName;
  const message = confirmation?.message;

  if (
    confirmation?.required !== true ||
    typeof toolName !== 'string' ||
    !toolName ||
    !args
  ) {
    return null;
  }

  return {
    toolName,
    args,
    message: typeof message === 'string' && message ? message : `确认执行 ${toolName}？`,
  };
}

export function getToolFailureMessage(toolName: string, result: ToolResult): string {
  const data = result.data;
  if (typeof data === 'string' && data.trim()) return data;

  const dataRecord = asRecord(data);
  for (const key of ['message', 'errorMessage', 'error']) {
    const value = dataRecord?.[key];
    if (typeof value === 'string' && value.trim()) return value;
  }

  return `${toolName} 执行失败，请重新发起操作。`;
}

export function formatApprovalSuccess(toolName: string, result: ToolResult): string {
  const data = asRecord(result.data);
  const order = asRecord(data?.order);
  if (!order) return `${toolName} 已成功执行。`;

  const verb = toolName === 'cancel_order' ? '订单已取消' : '订单已创建';
  const details: string[] = [];
  const orderId = order.orderId ?? order.id;

  if (typeof orderId === 'string') details.push(`订单号：${orderId}`);
  if (typeof order.status === 'string') details.push(`状态：${formatStatus(order.status)}`);
  if (typeof order.totalAmountCents === 'number') {
    details.push(`金额：${(order.totalAmountCents / 100).toFixed(2)} 元`);
  }

  return details.length ? `${verb}。${details.join('，')}。` : `${verb}。`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatStatus(status: string): string {
  if (status === 'submitted') return '已提交';
  if (status === 'cancelled') return '已取消';
  return status;
}
