import { Tool } from '@aws-sdk/client-bedrock-runtime';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';

type Transport = StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport;

// https://github.com/modelcontextprotocol/quickstart-resources/blob/main/mcp-client-typescript/index.ts
export class MCPClient {
  private mcp: Client;
  private transport: Transport | null = null;
  private _tools: Tool[] = [];

  private constructor() {
    this.mcp = new Client(
      { name: 'mcp-client-cli', version: '1.0.0' },
      {
        capabilities: {
          tools: {},
        },
      }
    );
  }

  static async fromCommand(command: string, args: string[], env?: Record<string, string>) {
    const client = new MCPClient();
    client.transport = new StdioClientTransport({
      cwd: '/tmp',
      command,
      args,
      env: { ...env, ...(process.env as Record<string, string>) },
    });
    await client.connectAndInitialize();
    return client;
  }

  static async fromUrl(url: string) {
    const baseUrl = new URL(url);
    try {
      const client = new MCPClient();
      client.transport = new StreamableHTTPClientTransport(baseUrl);
      await client.connectAndInitialize();
      console.log('Connected using Streamable HTTP transport');
      return client;
    } catch (error) {
      console.log('Streamable HTTP connection failed, falling back to SSE transport');
      const client = new MCPClient();
      client.transport = new SSEClientTransport(baseUrl);
      await client.connectAndInitialize();
      console.log('Connected using SSE transport');
      return client;
    }
  }

  public get tools() {
    return this._tools;
  }

  private async connectAndInitialize() {
    if (!this.transport) throw new Error('Transport not initialized');

    await this.mcp.connect(this.transport);

    const toolsResult = await this.mcp.listTools();
    this._tools = toolsResult.tools.map((tool) => {
      return {
        toolSpec: {
          name: tool.name,
          description: tool.description,
          inputSchema: { json: JSON.stringify(tool.inputSchema) },
        },
      };
    });
    console.log(
      'Connected to server with tools:',
      this._tools.map(({ toolSpec }) => toolSpec!.name)
    );
  }

  async callTool(toolName: string, input: any) {
    const result = await this.mcp.callTool({
      name: toolName,
      arguments: input,
    });
    // https://spec.modelcontextprotocol.io/specification/2024-11-05/server/tools/#tool-result
    const contentSchema = z.array(
      z.union([
        z.object({ type: z.literal('text'), text: z.string() }),
        z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() }),
      ])
    );
    const { success, data: content } = contentSchema.safeParse(result.content);
    if (!success) {
      return JSON.stringify(result);
    }
    return content;
  }

  async cleanup() {
    /**
     * Clean up resources
     */
    await this.mcp.close();
  }
}

// MCPClient.fromCommand('npx', ['-y', '@modelcontextprotocol/server-aws-kb-retrieval'], { aa: 'aa' });
