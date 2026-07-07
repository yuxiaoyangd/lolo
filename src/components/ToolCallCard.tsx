import { useState } from 'react';
import type { ToolCallEntry } from '../types';

interface Props {
  tool: ToolCallEntry;
}

export default function ToolCallCard({ tool }: Props) {
  const [open, setOpen] = useState(false);
  const label = `🔧 ${tool.name}`;

  return (
    <div className={`tool-card ${tool.result !== undefined ? (tool.success ? 'success' : 'error') : 'pending'}`}>
      <div className="tool-card-header" onClick={() => setOpen(!open)}>
        <span className="tool-card-label">{label}</span>
        <span className="tool-card-status">
          {tool.result === undefined ? '⏳ 执行中...' : tool.success ? '✓ 完成' : '✗ 失败'}
        </span>
        <span className="tool-card-toggle">{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div className="tool-card-detail">
          <div className="tool-card-section">
            <strong>参数:</strong>
            <pre>{JSON.stringify(tool.arguments, null, 2)}</pre>
          </div>
          {tool.result !== undefined && (
            <div className="tool-card-section">
              <strong>结果:</strong>
              <pre>{tool.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
