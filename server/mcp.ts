import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ResilientMcpConnection } from './mcp-connection.js';

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

const toolAnnotations = new Map<string, ModelTool['annotations']>();

async function connectClient(): Promise<Client> {
  const client = new Client({ name: 'lolo', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  await client.connect(transport);
  console.log(`[lolo] MCP connected: ${MCP_URL}`);
  return client;
}

const connection = new ResilientMcpConnection(connectClient);

export async function listMcpTools(): Promise<ModelTool[]> {
  const result = await connection.run('tools/list', (client) => client.listTools());

  const tools: ModelTool[] = result.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || tool.name,
      parameters: tool.inputSchema as Record<string, unknown>,
    },
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  }));

  toolAnnotations.clear();
  for (const tool of tools) toolAnnotations.set(tool.function.name, tool.annotations);
  return tools;
}

export async function callMcpTool(
  name: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const annotations = toolAnnotations.get(name);
  const replaySafe =
    annotations?.readOnlyHint === true || annotations?.idempotentHint === true;
  const result = (await connection.run(
    `tools/call ${name}`,
    (client) => client.callTool({ name, arguments: args }),
    {
      shouldRetry: (error) => replaySafe || isInvalidMcpSessionError(error),
    }
  )) as CallToolResult;
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
  await connection.close();
}

export async function getMcpStatus(): Promise<{ connected: true; toolCount: number }> {
  const tools = await listMcpTools();
  return { connected: true, toolCount: tools.length };
}

export function isInvalidMcpSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /session/iu.test(message) && /(missing|invalid|expired|unknown|not found|required)/iu.test(message);
}

function parseTextResult(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
