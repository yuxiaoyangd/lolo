import express from 'express';
import cors from 'cors';
import { chat, confirmApproval, rejectApproval } from './agent.js';
import { closeMcpClient, getMcpStatus } from './mcp.js';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/chat', async (req, res) => {
  const { messages } = req.body as { messages: { role: string; content: string | null }[] };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    for await (const event of chat(messages)) {
      res.write(event);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.write(`data: ${JSON.stringify({ type: 'error', content: msg })}\n\n`);
  }
  res.end();
});

app.post('/approvals/:approvalId/confirm', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    for await (const event of confirmApproval(req.params.approvalId)) {
      res.write(event);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.write(`data: ${JSON.stringify({ type: 'error', content: msg })}\n\n`);
  }
  res.end();
});

app.delete('/approvals/:approvalId', (req, res) => {
  res.json({ rejected: rejectApproval(req.params.approvalId) });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health/mcp', async (_req, res) => {
  try {
    const status = await getMcpStatus();
    res.json({ status: 'ok', ...status });
  } catch {
    res.status(503).json({ status: 'unavailable', connected: false });
  }
});

const PORT = process.env.LOLO_PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`lolo server → http://localhost:${PORT}`);
});

async function shutdown() {
  server.close();
  await closeMcpClient();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
