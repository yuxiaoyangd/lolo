import assert from 'node:assert/strict';
import test from 'node:test';
import {
  McpUnavailableError,
  ResilientMcpConnection,
  type ClosableMcpClient,
} from './mcp-connection';
import { isInvalidMcpSessionError } from './mcp';

interface FakeClient extends ClosableMcpClient {
  execute(): Promise<string>;
  closeCount: number;
}

function fakeClient(execute: () => Promise<string>): FakeClient {
  return {
    closeCount: 0,
    execute,
    async close() {
      this.closeCount += 1;
    },
  };
}

test('reconnects once and repeats a safe operation', async () => {
  const stale = fakeClient(async () => {
    throw new Error('Missing or invalid MCP session');
  });
  const fresh = fakeClient(async () => 'connected');
  const clients = [stale, fresh];
  let connectCount = 0;
  const connection = new ResilientMcpConnection(async () => clients[connectCount++]!);

  const result = await connection.run('tools/list', (client) => client.execute());

  assert.equal(result, 'connected');
  assert.equal(connectCount, 2);
  assert.equal(stale.closeCount, 1);
});

test('does not replay an operation when the retry policy rejects it', async () => {
  const client = fakeClient(async () => {
    throw new Error('fetch failed after request was sent');
  });
  let connectCount = 0;
  const connection = new ResilientMcpConnection(async () => {
    connectCount += 1;
    return client;
  });

  await assert.rejects(
    connection.run('tools/call unsafe', (value) => value.execute(), {
      shouldRetry: () => false,
    }),
    McpUnavailableError
  );
  assert.equal(connectCount, 1);
  assert.equal(client.closeCount, 1);
});

test('clears the second failed client so a later request can reconnect', async () => {
  const clients = [
    fakeClient(async () => {
      throw new Error('first failure');
    }),
    fakeClient(async () => {
      throw new Error('second failure');
    }),
    fakeClient(async () => 'recovered'),
  ];
  let connectCount = 0;
  const connection = new ResilientMcpConnection(async () => clients[connectCount++]!);

  await assert.rejects(
    connection.run('tools/list', (client) => client.execute()),
    McpUnavailableError
  );
  assert.equal(await connection.run('tools/list', (client) => client.execute()), 'recovered');
  assert.equal(connectCount, 3);
});

test('recognizes invalid MCP session errors without treating generic failures as sessions', () => {
  assert.equal(isInvalidMcpSessionError(new Error('Missing or invalid MCP session')), true);
  assert.equal(isInvalidMcpSessionError(new Error('Session ID is required')), true);
  assert.equal(isInvalidMcpSessionError(new Error('fetch failed')), false);
});
