const NODEXA_URL = process.env.NODEXA_URL || 'http://localhost:8080';

export interface IntentItem {
  intent: string;
  name: string;
  description: string;
}

export interface IntentsResponse {
  instructions: string;
  intents: IntentItem[];
}

export interface ParamField {
  type: string;
  required?: boolean;
  prompt?: string;
  options?: string[];
  default?: unknown;
}

export interface PluginDef {
  intent: string;
  name: string;
  description: string;
  params: Record<string, ParamField>;
  error?: { code: string };
}

export async function fetchIntents(): Promise<IntentsResponse> {
  const res = await fetch(`${NODEXA_URL}/intents`);
  return res.json() as Promise<IntentsResponse>;
}

export async function fetchPlugin(intent: string): Promise<PluginDef | null> {
  const res = await fetch(`${NODEXA_URL}/plugins/${intent}`);
  const data = (await res.json()) as PluginDef;
  if (data.error) return null;
  return data;
}

export async function execute(
  intent: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${NODEXA_URL}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent, params }),
  });
  return res.json() as Promise<Record<string, unknown>>;
}

export function buildParamSchema(params: Record<string, ParamField>) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, field] of Object.entries(params)) {
    const ft = field.type || 'text';
    let schema: Record<string, unknown> = { type: 'string' };

    if (ft === 'single_select' && field.options) {
      schema = { type: 'string', enum: field.options };
    } else if (ft === 'number') {
      schema = { type: 'number' };
    } else if (ft === 'location') {
      schema = { type: 'string', description: '坐标，格式 lat,lng 如 39.9,116.4' };
    }
    if (field.prompt) {
      schema.description = field.prompt;
    }

    properties[name] = schema;
    if (field.required) required.push(name);
  }

  return { type: 'object' as const, properties, required };
}
