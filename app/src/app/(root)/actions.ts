'use server';

import { z } from 'zod';
import { SessionRepository } from '@/common/sessionRepository';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { authActionClient } from '@/lib/safe-action';
import { mcpConfigSchema } from '@/common/schemas';

const startNovaSonicSessionSchema = z.object({
  systemPrompt: z.string(),
  voiceId: z.string(),
  mcpConfig: mcpConfigSchema,
});

// Initialize Lambda client
const lambdaClient = new LambdaClient({});

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
      // Invoke Nova Sonic processing Lambda
      const command = new InvokeCommand({
        FunctionName: process.env.NOVA_SONIC_LAMBDA_FUNCTION_NAME!,
        InvocationType: 'Event', // Async invocation
        Payload: JSON.stringify(payload),
      });

      await lambdaClient.send(command);

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
