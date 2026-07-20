export interface ClosableMcpClient {
  close(): Promise<void>;
}

interface RunOptions {
  shouldRetry?: (error: unknown) => boolean;
}

export class McpUnavailableError extends Error {
  constructor() {
    super('MCP 服务暂时不可用，未查询或执行任何真实服务，请稍后重试。');
    this.name = 'McpUnavailableError';
  }
}

export class ResilientMcpConnection<TClient extends ClosableMcpClient> {
  private clientPromise: Promise<TClient> | null = null;

  constructor(private readonly connect: () => Promise<TClient>) {}

  async run<TResult>(
    label: string,
    operation: (client: TClient) => Promise<TResult>,
    options: RunOptions = {}
  ): Promise<TResult> {
    try {
      return await operation(await this.getClient());
    } catch (firstError: unknown) {
      await this.reset();
      const shouldRetry = options.shouldRetry?.(firstError) ?? true;
      if (!shouldRetry) {
        console.warn(`[lolo] MCP ${label} failed and was not replayed: ${errorMessage(firstError)}`);
        throw new McpUnavailableError();
      }

      console.warn(`[lolo] MCP ${label} failed, reconnecting once: ${errorMessage(firstError)}`);
      try {
        return await operation(await this.getClient());
      } catch (secondError: unknown) {
        await this.reset();
        console.warn(`[lolo] MCP ${label} failed after reconnect: ${errorMessage(secondError)}`);
        throw new McpUnavailableError();
      }
    }
  }

  async close(): Promise<void> {
    await this.reset();
  }

  private async getClient(): Promise<TClient> {
    if (!this.clientPromise) {
      this.clientPromise = this.connect().catch((error) => {
        this.clientPromise = null;
        throw error;
      });
    }
    return this.clientPromise;
  }

  private async reset(): Promise<void> {
    const staleClient = this.clientPromise;
    this.clientPromise = null;
    if (!staleClient) return;

    try {
      const client = await staleClient;
      await client.close();
    } catch {
      // The transport may already be broken. Clearing the cached promise is sufficient.
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
