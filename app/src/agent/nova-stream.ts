import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
  InvokeModelWithBidirectionalStreamCommandOutput,
  InvokeModelWithBidirectionalStreamInput,
} from '@aws-sdk/client-bedrock-runtime';
import { Tool } from '@aws-sdk/client-bedrock-runtime';
import { randomUUID } from 'crypto';
import { NodeHttp2Handler } from '@smithy/node-http-handler';
import { ToolDefinition } from './tools/common';
import { tryExecuteMcpTool } from '@/agent/tools/mcp';

const MAX_AUDIO_INPUT_QUEUE_SIZE = 200;
const modelId = 'amazon.nova-2-sonic-v1:0';
const bedrock = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION || 'us-east-1',
  requestHandler: new NodeHttp2Handler({
    requestTimeout: 300000,
    sessionTimeout: 300000,
    disableConcurrentStreams: false,
    maxConcurrentStreams: 1,
  }),
});

/**
 * Handles Bedrock InvokeModelWithBidirectionalStream API streams.
 * Manages stream start/end and sends audio input events.
 *
 * For more details on input events:
 * https://docs.aws.amazon.com/nova/latest/userguide/input-events.html
 */
export class NovaStream {
  // Queues
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly eventQueue: Array<any> = [];
  private readonly audioInputQueue: string[] = [];

  // IDs
  private readonly promptName: string;
  private audioContentId: string;

  private isActive: boolean;
  private isAudioStarted: boolean;
  private isProcessingAudio: boolean;

  private _stream: InvokeModelWithBidirectionalStreamCommandOutput | undefined = undefined;

  constructor(
    private sessionId: string,
    private voiceId: string,
    private systemPrompt: string,
    private tools: ToolDefinition<any>[],
    private mcpTools: Tool[]
  ) {
    this.eventQueue = [];
    this.audioInputQueue = [];
    this.promptName = randomUUID();
    this.audioContentId = randomUUID();
    this.isAudioStarted = false;
    this.isProcessingAudio = false;
    this.isActive = true;
  }

  public get iterator() {
    if (!this._stream?.body) {
      throw new Error('Nova stream is not open yet!');
    }
    return this._stream.body;
  }

  public get isProcessing() {
    return this.isActive && this.isAudioStarted;
  }

  private createAsyncIterator() {
    const eventQueue = this.eventQueue;
    return {
      [Symbol.asyncIterator]: () => {
        return {
          next: async (): Promise<IteratorResult<InvokeModelWithBidirectionalStreamInput>> => {
            try {
              while (eventQueue.length === 0 && this.isActive) {
                await new Promise((s) => setTimeout(s, 100));
              }

              const nextEvent = eventQueue.shift();

              if (!nextEvent) {
                return { value: undefined, done: true };
              }

              if (nextEvent.event.sessionEnd) {
                this.isActive = false;
              }

              if (!nextEvent.event.audioInput) {
                console.log(JSON.stringify(nextEvent));
              }

              return {
                value: {
                  chunk: {
                    bytes: new TextEncoder().encode(JSON.stringify(nextEvent)),
                  },
                },
                done: false,
              };
            } catch (e) {
              console.error('Error in asyncIterator', e);
              return { value: undefined, done: true };
            }
          },
        };
      },
      return: async () => {
        return { value: undefined, done: true };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      throw: async (error: any) => {
        console.error(error);
        throw error;
      },
    };
  }

  /**
   * Open a bidirectional stream.
   * @param previousChatHistory When resuming a session, provide the previous chat history. It must be sorted by createdAt ASC.
   * @returns
   */
  public async open(
    previousChatHistory: { content: string; role: string }[]
  ): Promise<InvokeModelWithBidirectionalStreamCommandOutput> {
    // https://docs.aws.amazon.com/nova/latest/userguide/input-events.html
    this.enqueueSessionStart();
    this.enqueuePromptStart(this.voiceId);
    this.enqueueSystemPrompt(this.systemPrompt);

    const history = this.sliceChatHistory(previousChatHistory);
    console.log('opening a session');
    console.log(JSON.stringify(history));
    history.forEach((chat) => {
      this.enqueueChatHistory(chat.content, chat.role);
    });
    this.enqueueAudioStart();

    const asyncIterator = this.createAsyncIterator();

    const response = await bedrock.send(
      new InvokeModelWithBidirectionalStreamCommand({
        modelId,
        body: asyncIterator,
      })
    );

    this._stream = response;

    return response;
  }

  private sliceChatHistory(chatHistory: { content: string; role: string }[]): { content: string; role: string }[] {
    // First message in chat history should User, not Assistant.
    // each chat history message should be less than 1024 and total chat history should be less than 40,960.
    // the input chat history is sorted in chronological order (asc)
    // output the history so that it is the latest N messages following the above rules.

    if (!chatHistory || chatHistory.length === 0) {
      return [];
    }

    const MAX_MESSAGE_LENGTH = 1024;
    const MAX_TOTAL_LENGTH = 40960;

    // Concatenate consecutive messages with the same role
    const concatenatedHistory: { content: string; role: string }[] = [];
    for (let i = 0; i < chatHistory.length; i++) {
      const currentMessage = chatHistory[i];
      const lastMessage = concatenatedHistory[concatenatedHistory.length - 1];

      if (lastMessage && lastMessage.role.toUpperCase() === currentMessage.role.toUpperCase()) {
        // Concatenate with the previous message
        lastMessage.content += ' ' + currentMessage.content;
      } else {
        // Add as new message
        concatenatedHistory.push({ ...currentMessage });
      }
    }

    // Truncate each message if needed
    const truncatedHistory = concatenatedHistory.map((chat) => ({
      ...chat,
      content: chat.content.length > MAX_MESSAGE_LENGTH ? chat.content.substring(0, MAX_MESSAGE_LENGTH) : chat.content,
    }));

    // Work backwards from the end to get the latest messages
    const result: { content: string; role: string }[] = [];
    let totalLength = 0;

    for (let i = truncatedHistory.length - 1; i >= 0; i--) {
      const message = truncatedHistory[i];
      const messageLength = message.content.length;

      if (totalLength + messageLength > MAX_TOTAL_LENGTH) {
        break;
      }

      result.unshift(message);
      totalLength += messageLength;
    }

    // Ensure first message is from User, not Assistant
    while (result.length > 0 && result[0].role.toUpperCase() === 'ASSISTANT') {
      const removedMessage = result.shift()!;
      totalLength -= removedMessage.content.length;
    }

    // Remove the last message from user
    while (result.length > 0 && result[result.length - 1].role.toUpperCase() === 'USER') {
      const removedMessage = result.pop()!;
      totalLength -= removedMessage.content.length;
    }

    return result;
  }

  public close() {
    console.log('closing a session');
    const promptName = this.promptName;
    this.eventQueue.push({
      event: {
        contentEnd: {
          promptName,
          contentName: this.audioContentId,
        },
      },
    });
    this.eventQueue.push({
      event: {
        promptEnd: {
          promptName,
        },
      },
    });
    this.eventQueue.push({
      event: {
        sessionEnd: {},
      },
    });
    this._stream = undefined;
    this.isAudioStarted = false;
  }

  public enqueueSessionStart() {
    this.eventQueue.push({
      event: {
        sessionStart: {
          inferenceConfiguration: {
            maxTokens: 1024,
            topP: 0.9,
            temperature: 1,
          },
        },
      },
    });
  }

  public enqueuePromptStart(voiceId: string) {
    const promptName = this.promptName;
    this.eventQueue.push({
      event: {
        promptStart: {
          promptName,
          textOutputConfiguration: {
            mediaType: 'text/plain',
          },
          audioOutputConfiguration: {
            audioType: 'SPEECH',
            encoding: 'base64',
            mediaType: 'audio/lpcm',
            sampleRateHertz: 24000,
            sampleSizeBits: 16,
            channelCount: 1,
            voiceId,
          },
          ...(this.tools.length > 0
            ? {
                toolUseOutputConfiguration: {
                  mediaType: 'application/json',
                },
                toolConfiguration: {
                  tools: [
                    ...this.tools.map((tool) => ({
                      toolSpec: tool.toolSpec(),
                    })),
                    ...this.mcpTools.map((tool) => ({ toolSpec: tool.toolSpec! })),
                  ],
                },
              }
            : {}),
        },
      },
    });
  }

  public enqueueSystemPrompt(prompt: string) {
    const promptName = this.promptName;
    const contentName = randomUUID();

    this.eventQueue.push({
      event: {
        contentStart: {
          promptName,
          contentName,
          type: 'TEXT',
          interactive: false,
          role: 'SYSTEM',
          textInputConfiguration: {
            mediaType: 'text/plain',
          },
        },
      },
    });

    this.eventQueue.push({
      event: {
        textInput: {
          promptName,
          contentName,
          content: prompt,
        },
      },
    });

    this.eventQueue.push({
      event: {
        contentEnd: {
          promptName,
          contentName,
        },
      },
    });
  }

  private enqueueChatHistory(content: string, role: string): void {
    const promptName = this.promptName;
    // Text content start
    const textPromptID = randomUUID();
    this.eventQueue.push({
      event: {
        contentStart: {
          promptName,
          contentName: textPromptID,
          type: 'TEXT',
          interactive: false,
          textInputConfiguration: { mediaType: 'text/plain' },
        },
      },
    });

    // Text input content
    this.eventQueue.push({
      event: {
        textInput: {
          promptName,
          contentName: textPromptID,
          content: content,
          role: role.toUpperCase(),
        },
      },
    });

    // Text content end
    this.eventQueue.push({
      event: {
        contentEnd: {
          promptName,
          contentName: textPromptID,
        },
      },
    });
  }

  private enqueueToolResult(toolUseId: string, result: string) {
    const promptName = this.promptName;
    const contentName = randomUUID();

    // Tool content start
    this.eventQueue.push({
      event: {
        contentStart: {
          promptName,
          contentName,
          interactive: false,
          type: 'TOOL',
          role: 'TOOL',
          toolResultInputConfiguration: {
            toolUseId: toolUseId,
            type: 'TEXT',
            textInputConfiguration: {
              mediaType: 'text/plain',
            },
          },
        },
      },
    });

    // Tool content input
    this.eventQueue.push({
      event: {
        toolResult: {
          promptName,
          contentName,
          content: result,
        },
      },
    });

    // Tool content end
    this.eventQueue.push({
      event: {
        contentEnd: {
          promptName,
          contentName,
        },
      },
    });
  }

  public enqueueAudioStart() {
    const promptName = this.promptName;
    this.audioContentId = randomUUID();

    this.eventQueue.push({
      event: {
        contentStart: {
          promptName,
          contentName: this.audioContentId,
          type: 'AUDIO',
          interactive: true,
          role: 'USER',
          audioInputConfiguration: {
            audioType: 'SPEECH',
            encoding: 'base64',
            mediaType: 'audio/lpcm',
            sampleRateHertz: 16000,
            sampleSizeBits: 16,
            channelCount: 1,
          },
        },
      },
    });

    this.isAudioStarted = true;
  }

  public enqueueAudioInput(audioInputBase64Array: string[]) {
    if (!this.isAudioStarted || !this.isActive) {
      return;
    }

    for (const audioInput of audioInputBase64Array) {
      this.audioInputQueue.push(audioInput);
    }

    // Audio input queue full, dropping oldest chunk
    while (this.audioInputQueue.length - MAX_AUDIO_INPUT_QUEUE_SIZE > 0) {
      this.audioInputQueue.shift();
    }

    if (!this.isProcessingAudio) {
      this.isProcessingAudio = true;
      // Start audio event loop
      this.processAudioQueue();
    }
  }

  private async processAudioQueue() {
    while (this.audioInputQueue.length > 0 && this.isAudioStarted && this.isActive) {
      const audioChunk = this.audioInputQueue.shift();

      this.eventQueue.push({
        event: {
          audioInput: {
            promptName: this.promptName,
            contentName: this.audioContentId,
            content: audioChunk,
          },
        },
      });
    }

    if (this.isAudioStarted) {
      setTimeout(() => this.processAudioQueue(), 0);
    } else {
      console.log('Processing audio is ended.');
      this.isProcessingAudio = false;
    }
  }

  private async executeTool(toolName: string, input: string) {
    try {
      JSON.parse(input);
    } catch (e) {
      return `Input must be valid JSON: ${input}`;
    }

    const mcpResult = await tryExecuteMcpTool(this.sessionId, toolName, JSON.parse(input));
    if (mcpResult.found) {
      console.log(`Used MCP tool: ${toolName} ${input}`);
      if (typeof mcpResult.content == 'string') {
        return JSON.stringify({ result: mcpResult.content });
      } else if (Array.isArray(mcpResult.content)) {
        return JSON.stringify({
          result: mcpResult.content
            .filter((c) => c.type == 'text')
            .map((c) => c.text)
            .join('\n\n'),
        });
      }
      throw new Error('Unexpected MCP result');
    }

    const tool = this.tools.find((tool) => tool.name == toolName);
    if (!tool) return `Cannot find tool ${toolName}`;
    const { data: parsedInput, error } = tool.schema.safeParse(JSON.parse(input));
    if (error) return `Input validation error: ${JSON.stringify(error)}`;
    try {
      const result = await tool.handler(parsedInput, {});
      if (typeof result == 'string') {
        return JSON.stringify({ result });
      } else {
        return JSON.stringify(result);
      }
    } catch (e) {
      return `Error executing tool ${toolName}: ${e}`;
    }
  }

  public async executeToolAndSendResult(toolUseId: string, toolName: string, input: string) {
    const res = await this.executeTool(toolName, input);
    this.enqueueToolResult(toolUseId, res);
    return res;
  }
}
