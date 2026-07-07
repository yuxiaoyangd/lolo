import OpenAI from 'openai';

const BASE_URL = process.env.VOLCANO_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3';
const API_KEY = process.env.VOLCANO_API_KEY || '';
const MODEL = process.env.VOLCANO_MODEL || 'deepseek-v4-flash-260425';

export const client = new OpenAI({
  baseURL: BASE_URL,
  apiKey: API_KEY,
});

export { MODEL };
