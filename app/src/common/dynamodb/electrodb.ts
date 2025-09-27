import { Entity } from 'electrodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({});
const table = process.env.TABLE_NAME || 'ConversationsTable';

// Message Entity for storing conversation messages
export const MessageEntity = new Entity(
  {
    model: {
      entity: 'message',
      version: '1',
      service: 'conversation',
    },
    attributes: {
      sessionId: {
        type: 'string',
        required: true,
      },
      timestamp: {
        type: 'number',
        required: true,
      },
      role: {
        type: 'string',
        required: true,
      },
      content: {
        type: 'string',
        required: true,
      },
    },
    indexes: {
      // Primary key for the table
      byTimestamp: {
        pk: {
          field: 'PK',
          composite: ['sessionId'],
        },
        sk: {
          field: 'SK',
          composite: ['timestamp'],
        },
      },
    },
  },
  {
    table,
    client,
  }
);

// Session Entity for managing conversation sessions
export const SessionEntity = new Entity(
  {
    model: {
      entity: 'session',
      version: '1',
      service: 'conversation',
    },
    attributes: {
      userId: {
        type: 'string',
        required: true,
      },
      sessionId: {
        type: 'string',
        required: true,
      },
      createdAt: {
        type: 'number',
        required: true,
        default: () => Date.now(),
      },
      systemPrompt: {
        type: 'string',
      },
      mcpConfig: {
        type: 'string',
      },
    },
    indexes: {
      // Primary key for the table
      byUser: {
        pk: {
          field: 'PK',
          composite: ['userId'],
        },
        sk: {
          field: 'SK',
          composite: ['sessionId'],
        },
      },
      // GSI for querying sessions by last updated time
      byCreatedAt: {
        index: 'GSI1',
        pk: {
          field: 'GSI1PK',
          composite: ['userId'],
        },
        sk: {
          field: 'GSI1SK',
          composite: ['createdAt'],
        },
      },
    },
  },
  {
    table,
    client,
  }
);

export const Services = {
  message: MessageEntity,
  session: SessionEntity,
};

export { client };
