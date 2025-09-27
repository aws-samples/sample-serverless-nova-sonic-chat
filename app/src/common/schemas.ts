import { z } from 'zod';

export const SpeechToSpeechEventSchema = z.discriminatedUnion('event', [
  // event schemas sent from server (btoc, bedrock to client)
  z.object({
    direction: z.literal('btoc'),
    event: z.literal('ready'),
    data: z.object({}),
  }),
  z.object({
    direction: z.literal('btoc'),
    event: z.literal('audioOutput'),
    data: z.object({
      blobs: z.array(z.string()),
      sequence: z.number(),
    }),
  }),
  z.object({
    direction: z.literal('btoc'),
    event: z.literal('textStart'),
    data: z.object({
      id: z.string(),
      role: z.string(),
      generationStage: z.string(),
    }),
  }),
  z.object({
    direction: z.literal('btoc'),
    event: z.literal('textOutput'),
    data: z.object({
      id: z.string(),
      role: z.string(),
      content: z.string(),
    }),
  }),
  z.object({
    direction: z.literal('btoc'),
    event: z.literal('textStop'),
    data: z.object({
      id: z.string(),
      stopReason: z.string(),
    }),
  }),
  z.object({
    direction: z.literal('btoc'),
    event: z.literal('end'),
    data: z.object({
      reason: z.string().optional(),
    }),
  }),

  // event schemas sent from client (ctob, client to bedrock)
  z.object({
    direction: z.literal('ctob'),
    event: z.literal('audioInput'),
    data: z.object({
      blobs: z.array(z.string()),
      sequence: z.number(),
    }),
  }),
  z.object({
    direction: z.literal('ctob'),
    event: z.literal('terminateSession'),
    data: z.object({}),
  }),
]);

export type SpeechToSpeechEvent = z.infer<typeof SpeechToSpeechEventSchema>;
export type SpeechToSpeechEventType = SpeechToSpeechEvent['event'];
export type DispatchEventParams = Omit<SpeechToSpeechEvent, 'direction'>;

export const mcpConfigSchema = z.object({
  mcpServers: z.record(
    z.string(),
    z.union([
      z.object({
        command: z.string(),
        args: z.array(z.string()),
        env: z.record(z.string(), z.string()).optional(),
        enabled: z.boolean().optional(),
      }),
      z.object({
        url: z.string(),
        enabled: z.boolean().optional(),
      }),
    ])
  ),
});

export type McpConfig = z.infer<typeof mcpConfigSchema>;
export const EmptyMcpConfig: McpConfig = { mcpServers: {} };
