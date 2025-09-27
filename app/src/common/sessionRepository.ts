import { v4 as uuidv4 } from 'uuid';
import { SessionEntity } from './dynamodb';
import { McpConfig } from '@/common/schemas';

export type Session = {
  userId: string;
  sessionId: string;
  systemPrompt?: string;
  createdAt: number;
};

export class SessionRepository {
  /**
   * Creates a new session
   * @param userId User ID
   * @param title Session title (optional)
   * @returns Created session
   */
  async createSession(userId: string, mcpConfig: McpConfig): Promise<Session> {
    const sessionId = uuidv4();
    const timestamp = Date.now();

    await SessionEntity.put({
      userId,
      sessionId,
      createdAt: timestamp,
      mcpConfig: JSON.stringify(mcpConfig, undefined, 2),
    }).go();

    return {
      userId,
      sessionId,
      createdAt: timestamp,
    };
  }

  /**
   * Gets a session
   * @param userId User ID
   * @param sessionId Session ID
   * @returns Session object, or null if not found
   */
  async getSession(userId: string, sessionId: string): Promise<Session | null> {
    const result = await SessionEntity.get({
      userId,
      sessionId,
    }).go();

    if (!result.data) {
      return null;
    }

    return {
      ...result.data,
    };
  }

  /**
   * Gets all user sessions sorted by last update time
   * @param userId User ID
   * @returns Array of sessions sorted by last update time
   */
  async getSessions(userId: string): Promise<Session[]> {
    const result = await SessionEntity.query.byCreatedAt({ userId }).go({ order: 'desc' });

    return result.data.map((item) => ({
      ...item,
    }));
  }

  /**
   * Updates system prompt
   * @param userId User ID to update
   * @param sessionId Session ID to update
   * @param systemPrompt System prompt
   */
  async updateSystemPrompt(userId: string, sessionId: string, systemPrompt: string) {
    await SessionEntity.update({
      userId,
      sessionId,
    })
      .set({ systemPrompt })
      .go();
  }

  /**
   * Deletes a session
   * @param userId User ID
   * @param sessionId Session ID
   */
  async deleteSession(userId: string, sessionId: string): Promise<void> {
    await SessionEntity.delete({
      userId,
      sessionId,
    }).go();
  }
}
