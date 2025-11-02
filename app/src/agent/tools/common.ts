import { ToolResultContentBlock, Tool } from '@aws-sdk/client-bedrock-runtime';
import { ZodType } from 'zod';

export type ToolDefinition<Input> = {
  /**
   * Name of the tool. This is the identifier of the tool for the agent.
   */
  readonly name: string;
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  readonly handler: (input: Input, context: {}) => Promise<string | object>;
  readonly schema: ZodType;
  readonly toolSpec: () => { name: string; description: string; inputSchema: { json: string } };
};
