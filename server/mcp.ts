import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const MCP_URL = process.env.MCP_URL || 'http://127.0.0.1:3100/mcp';

export interface ModelTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

let clientPromise: Promise<Client> | null = null;

async function connectClient(): Promise<Client> {
  const client = new Client({ name: 'lolo', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  await client.connect(transport);
  console.log(`[lolo] MCP connected: ${MCP_URL}`);
  return client;
}

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = connectClient().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

export async function listMcpTools(): Promise<ModelTool[]> {
  const client = await getClient();
  const result = await client.listTools();

  return result.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || tool.name,
      parameters: tool.inputSchema as Record<string, unknown>,
    },
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  }));
}

export async function callMcpTool(
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const client = await getClient();
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');

  return {
    ok: !result.isError,
    ...(result.structuredContent
      ? { data: result.structuredContent }
      : text
        ? { data: parseTextResult(text) }
        : { data: result.content }),
  };
}

export async function closeMcpClient(): Promise<void> {
  if (!clientPromise) return;
  try {
    const client = await clientPromise;
    await client.close();
  } finally {
    clientPromise = null;
  }
}

function parseTextResult(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
