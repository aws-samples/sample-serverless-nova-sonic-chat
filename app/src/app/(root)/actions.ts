'use server';

import { z } from 'zod';
import { SessionRepository } from '@/common/sessionRepository';
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
import { authActionClient } from '@/lib/safe-action';
import { mcpConfigSchema } from '@/common/schemas';

const agentCore = new BedrockAgentCoreClient({});

const startNovaSonicSessionSchema = z.object({
  systemPrompt: z.string(),
  voiceId: z.string(),
  mcpConfig: mcpConfigSchema,
});

export const startNovaSonicSession = authActionClient
  .inputSchema(startNovaSonicSessionSchema)
  .action(async ({ parsedInput, ctx }) => {
    const userId = ctx.userId;
    const sessionRepository = new SessionRepository();

    // Create new session in DynamoDB
    const session = await sessionRepository.createSession(userId, parsedInput.mcpConfig);

    // Prepare payload for Nova Sonic Lambda
    const payload = {
      sessionId: session.sessionId,
      userId: session.userId,
      systemPrompt: parsedInput.systemPrompt,
      voiceId: parsedInput.voiceId,
      mcpConfig: parsedInput.mcpConfig,
    };

    try {
      const res = await agentCore.send(
        new InvokeAgentRuntimeCommand({
          agentRuntimeArn: process.env.AGENT_CORE_RUNTIME_ARN,
          runtimeSessionId: session.sessionId,
          payload: JSON.stringify(payload),
          contentType: 'application/json',
        })
      );

      return {
        success: true,
        sessionId: session.sessionId,
        systemPrompt: parsedInput.systemPrompt,
        message: 'Nova Sonic processing initiated successfully',
      };
    } catch (error) {
      console.error('Failed to invoke Nova Sonic Lambda:', error);

      // Clean up the session if Lambda invocation fails
      await sessionRepository.deleteSession(userId, session.sessionId);

      throw new Error('Failed to start Nova Sonic processing');
    }
  });
