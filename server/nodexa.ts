const NODEXA_URL = process.env.NODEXA_URL || 'http://localhost:8080';

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export async function fetchTools(): Promise<ToolDef[]> {
  const res = await fetch(`${NODEXA_URL}/tools`);
  return res.json() as Promise<ToolDef[]>;
}

export async function execute(
  tool: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${NODEXA_URL}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, params }),
  });
  return res.json() as Promise<Record<string, unknown>>;
}
