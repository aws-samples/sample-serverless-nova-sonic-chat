import { events, EventsChannel } from 'aws-amplify/data';
import { ModelStreamErrorException } from '@aws-sdk/client-bedrock-runtime';
import { DispatchEventParams, SpeechToSpeechEvent, SpeechToSpeechEventSchema } from '@/common/schemas';
import { MessageRepository } from '@/common/messageRepository';
import { NovaStream } from './nova-stream';
import './amplify';
import { AudioEventSequencer } from '@/common/events';

const MIN_AUDIO_OUTPUT_QUEUE_SIZE = 10;
const MAX_AUDIO_OUTPUT_PER_BATCH = 20;
let audioOutputQueue: string[] = [];
let unprocessedClientEvents: SpeechToSpeechEvent[] = [];
let audioOutputSequence = 0;

export const dispatchEvent = async (channel: EventsChannel, params: DispatchEventParams) => {
  try {
    await channel.publish({
      direction: 'btoc',
      ...params,
    });
  } catch (e) {
    console.log('Failed to publish the event via channel. The channel might be closed', params.event, params.data);
    console.log(e);
  }
};

// Send Nova's audio output to frontend in batches
// Without batching, playback tends to be choppy on the frontend
const enqueueAudioOutput = async (channel: EventsChannel, audioOutput: string) => {
  audioOutputQueue.push(audioOutput);

  if (audioOutputQueue.length > MIN_AUDIO_OUTPUT_QUEUE_SIZE) {
    const chunksToProcess: string[] = [];

    let processedChunks = 0;

    while (audioOutputQueue.length > 0 && processedChunks < MAX_AUDIO_OUTPUT_PER_BATCH) {
      const chunk = audioOutputQueue.shift();

      if (chunk) {
        chunksToProcess.push(chunk);
        processedChunks += 1;
      }
    }

    await dispatchEvent(channel, {
      event: 'audioOutput',
      data: { blobs: chunksToProcess, sequence: audioOutputSequence },
    });
    audioOutputSequence++;
  }
};

const forcePublishAudioOutput = async (channel: EventsChannel) => {
  const chunksToProcess = [];

  while (audioOutputQueue.length > 0) {
    const chunk = audioOutputQueue.shift();
    if (chunk) {
      chunksToProcess.push(chunk);
    }
  }

  await dispatchEvent(channel, {
    event: 'audioOutput',
    data: { blobs: chunksToProcess, sequence: audioOutputSequence },
  });
  audioOutputSequence++;
};

export const initializeSubscription = async (channelPath: string, context: { stream?: NovaStream }) => {
  audioOutputQueue = [];
  unprocessedClientEvents = [];
  audioOutputSequence = 0;
  const channel = await events.connect(channelPath);
  let clientInitialized = false;
  console.log(`Connected to the event channel ${channelPath}`);
  const sequencer = new AudioEventSequencer((chunks) => {
    context.stream!.enqueueAudioInput(chunks);
  });

  const processEventsFromClient = (event: SpeechToSpeechEvent) => {
    const stream = context.stream;
    // Queue items during session reconnection
    if (!stream?.isProcessing) {
      unprocessedClientEvents.push(event);
      return;
    }
    const events = [...unprocessedClientEvents, event];
    for (const event of events) {
      if (event.direction !== 'ctob') {
        continue;
      }
      clientInitialized = true;
      if (event.event === 'audioInput') {
        sequencer.next(event.data.blobs, event.data.sequence);
      } else if (event.event === 'terminateSession') {
        stream.close();
      }
    }
    unprocessedClientEvents = [];
  };

  channel.subscribe({
    next: async (data: { event: unknown }) => {
      const { data: event, error } = SpeechToSpeechEventSchema.safeParse(data.event);
      if (error) {
        console.log(error);
        return;
      }
      if (!['audioInput'].includes(event.event)) {
        console.log(JSON.stringify(event));
      }
      processEventsFromClient(event);
    },
    error: console.error,
  });

  // Periodically send ready event until client is also ready
  const readyAt = Date.now();
  const readyInterval = setInterval(async () => {
    if (Date.now() - readyAt > 60 * 1000) {
      clearInterval(readyInterval);
      console.log('client did not respond. stopping ready events.');
      return;
    }
    if (clientInitialized) {
      clearInterval(readyInterval);
      console.log('ctob event received, stopping ready event dispatcher');
      return;
    }

    try {
      await dispatchEvent(channel!, { event: 'ready', data: {} });
      console.log("I'm ready");
    } catch (error) {
      console.error('Failed to dispatch ready event:', error);
    }
  }, 1000);

  return channel;
};

export const processResponseStream = async (
  channel: EventsChannel,
  stream: NovaStream,
  sessionId: string,
  invokedAt: number
): Promise<{ state: 'success' | 'error' | 'resume' }> => {
  const messageRepository = new MessageRepository();

  const startedAt = Date.now();
  const willResumeIn = Math.floor(Math.random() * 330 + 120); // 120 to 450 seconds

  const contents: { [key: string]: { role: string; content: string; isFinal: boolean } } = {};
  const toolUses: { [key: string]: { toolUseId: string; content: string; toolName: string } } = {};

  for await (const event of stream.iterator) {
    try {
      if (event.chunk?.bytes) {
        const textResponse = new TextDecoder().decode(event.chunk.bytes);
        const jsonResponse = JSON.parse(textResponse);
        if (!['audioOutput'].some((type) => type in jsonResponse.event)) {
          console.log(textResponse);
        }

        if (jsonResponse.event?.audioOutput) {
          await enqueueAudioOutput(channel, jsonResponse.event.audioOutput.content);
        } else if (jsonResponse.event?.contentEnd && jsonResponse.event?.contentEnd?.type === 'AUDIO') {
          await forcePublishAudioOutput(channel);
        } else if (jsonResponse.event?.contentStart && jsonResponse.event?.contentStart?.type === 'TEXT') {
          let generationStage = null;

          if (jsonResponse.event?.contentStart?.additionalModelFields) {
            generationStage = JSON.parse(jsonResponse.event?.contentStart?.additionalModelFields).generationStage;
          }
          contents[jsonResponse.event?.contentStart?.contentId as string] = {
            role: jsonResponse.event?.contentStart?.role?.toLowerCase(),
            content: '',
            isFinal: generationStage == 'FINAL',
          };

          await dispatchEvent(channel, {
            event: 'textStart',
            data: {
              id: jsonResponse.event?.contentStart?.contentId,
              role: jsonResponse.event?.contentStart?.role?.toLowerCase(),
              generationStage,
            },
          });
        } else if (jsonResponse.event?.textOutput) {
          const role = jsonResponse.event?.textOutput?.role?.toLowerCase();
          const content = jsonResponse.event?.textOutput?.content || '';

          const existingContent = contents[jsonResponse.event?.textOutput?.contentId as string];
          if (content != '{ "interrupted" : true }') {
            existingContent.content += content;
          }

          await dispatchEvent(channel, {
            event: 'textOutput',
            data: {
              id: jsonResponse.event?.textOutput?.contentId,
              role: role,
              content: jsonResponse.event?.textOutput?.content,
            },
          });
        } else if (jsonResponse.event?.contentEnd && jsonResponse.event?.contentEnd?.type === 'TEXT') {
          const existingContent = contents[jsonResponse.event?.contentEnd?.contentId as string];

          await dispatchEvent(channel, {
            event: 'textStop',
            data: {
              id: jsonResponse.event?.contentEnd?.contentId,
              stopReason: jsonResponse.event?.contentEnd?.stopReason,
            },
          });

          try {
            console.log(JSON.stringify(contents));
            if (existingContent.isFinal && existingContent.content) {
              // do not save speculative content as it might not be actually spoken yet.
              // see: https://docs.aws.amazon.com/nova/latest/userguide/output-events.html
              await messageRepository.saveMessage(sessionId, {
                role: existingContent.role as any,
                content: existingContent.content.replaceAll('  ', ' ').trim(),
              });
              console.log('Message saved to DynamoDB');

              if (existingContent.role == 'assistant') {
                // Event when Nova finishes speaking - end the stream here
                if (jsonResponse.event?.contentEnd?.stopReason == 'END_TURN') {
                  // Nova Sonic's single stream is limited to 8 minutes
                  if (Date.now() - startedAt > 1000 * willResumeIn) {
                    return { state: 'resume' };
                  }
                }
              }
            }
          } catch (error) {
            console.error('Failed to save message to DynamoDB:', error);
          }
        } else if (jsonResponse.event?.toolUse) {
          // await dispatchEvent(sessionId, 'toolUse', jsonResponse.event.toolUse);
          // // Store tool use information for later
          toolUses[jsonResponse.event.toolUse.contentId] = {
            toolUseId: jsonResponse.event.toolUse.toolUseId,
            toolName: jsonResponse.event.toolUse.toolName,
            content: jsonResponse.event.toolUse.content,
          };
        } else if (jsonResponse.event?.contentEnd && jsonResponse.event?.contentEnd?.type === 'TOOL') {
          const toolUse = toolUses[jsonResponse.event.contentEnd.contentId];
          const result = await stream.executeToolAndSendResult(toolUse.toolUseId, toolUse.toolName, toolUse.content);
        }
      }
    } catch (e) {
      console.error('Error in processResponseStream', e);

      if (e instanceof ModelStreamErrorException) {
        console.log('Retrying...');
      } else {
        return { state: 'error' };
      }
    }
  }
  return { state: 'success' };
};
