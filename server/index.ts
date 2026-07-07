import express from 'express';
import cors from 'cors';
import { chat } from './agent.js';

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

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.LOLO_PORT || 3000;
app.listen(PORT, () => {
  console.log(`lolo server → http://localhost:${PORT}`);
});
