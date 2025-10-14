// API implementation for agent core runtime
// https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/runtime-service-contract.html

import express from 'express';
import z from 'zod';
import { mcpConfigSchema } from '@/common/schemas';
import { main } from '@/agent';

let currentStatus: 'busy' | 'idle' = 'idle';
const app = express();

app.use(express.json());

const bodySchema = z.object({
  sessionId: z.string(),
  userId: z.string(),
  systemPrompt: z.string(),
  voiceId: z.string(),
  mcpConfig: mcpConfigSchema,
});

app.post('/invocations', async (req, res) => {
  const body = bodySchema.parse(req.body);
  console.log(body);

  const { sessionId, userId, systemPrompt, voiceId, mcpConfig } = body;
  currentStatus = 'busy';
  main(sessionId, userId, systemPrompt, voiceId, mcpConfig)
    .catch((e) => {
      console.log(e);
    })
    .finally(() => {
      currentStatus = 'idle';
    });

  res.json({
    response: 'ok',
    status: 'success',
  });
});

app.get('/ping', (_req, res) => {
  res.json({
    status: currentStatus == 'idle' ? 'Healthy' : 'HealthyBusy',
    time_of_last_update: Math.floor(Date.now() / 1000),
  });
});

const port = 8080;
app.listen(port, () => {
  console.log(`Agent server listening on 0.0.0.0:${port}`);
});
