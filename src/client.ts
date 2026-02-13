import type {
  ChannelProbeResult,
  MessagesResponse,
  WsTicketResponse,
  Task,
  TasksListResponse,
  CreateTaskResponse,
} from './types';

/**
 * HTTP client for the ClawHouse bot API.
 * All endpoints use tRPC via HTTP POST/GET.
 */
/** Default timeout for API requests (30 seconds). */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class ClawHouseClient {
  private botToken: string;
  private apiUrl: string;
  private requestTimeoutMs: number;

  constructor(
    botToken: string,
    apiUrl: string,
    options?: { requestTimeoutMs?: number },
  ) {
    this.botToken = botToken;
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    procedure: string,
    input?: unknown,
  ): Promise<T> {
    const url =
      method === 'GET' && input
        ? `${this.apiUrl}/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`
        : `${this.apiUrl}/${procedure}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bot ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: method === 'POST' ? JSON.stringify(input) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch((err) => {
          const errMsg = err instanceof Error ? err.message : String(err);
          return `(failed to read response body: ${errMsg})`;
        });

        // Categorize errors for better debugging
        if (response.status === 401 || response.status === 403) {
          throw new Error(
            `ClawHouse API authentication failed: ${response.status} ${response.statusText} — ${text}`,
          );
        } else if (response.status >= 500) {
          throw new Error(
            `ClawHouse API server error: ${response.status} ${response.statusText} — ${text}`,
          );
        } else {
          throw new Error(
            `ClawHouse API error: ${response.status} ${response.statusText} — ${text}`,
          );
        }
      }

      const json = (await response.json()) as { result?: { data?: T } };

      // Validate tRPC response structure
      if (!json.result || json.result.data === undefined) {
        throw new Error(
          `ClawHouse API returned invalid tRPC response structure for ${procedure}`,
        );
      }

      return json.result.data;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(
          `ClawHouse API request to ${procedure} timed out after ${this.requestTimeoutMs}ms`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // Messages
  async typing(input?: { taskId?: string }): Promise<void> {
    return this.request('POST', 'messages.typing', input ?? {});
  }

  async sendMessage(input: {
    userId?: string;
    content: string;
    taskId?: string;
    attachments?: Array<{
      s3Key: string;
      name: string;
      contentType: string;
      size: number;
    }>;
  }): Promise<void> {
    return this.request('POST', 'messages.send', input);
  }

  async listMessages(input: {
    userId?: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<MessagesResponse> {
    return this.request<MessagesResponse>('GET', 'messages.list', input);
  }

  // WebSocket ticket
  async getWsTicket(): Promise<WsTicketResponse> {
    return this.request<WsTicketResponse>('POST', 'messages.wsTicket', {});
  }

  // Tasks
  async createTask(input: {
    title: string;
    instructions?: string;
  }): Promise<CreateTaskResponse> {
    return this.request('POST', 'tasks.create', input);
  }

  async listTasks(input?: {
    status?: string;
  }): Promise<TasksListResponse> {
    return this.request('GET', 'tasks.list', input ?? {});
  }

  async claimTask(input: { taskId: string }): Promise<Task> {
    return this.request('POST', 'tasks.claim', input);
  }

  async releaseTask(input: { taskId: string }): Promise<Task> {
    return this.request('POST', 'tasks.release', input);
  }

  async requestReview(input: { taskId: string; comment?: string }): Promise<Task> {
    return this.request('POST', 'tasks.requestReview', input);
  }

  async updateDeliverable(input: { taskId: string; deliverable: string }): Promise<void> {
    return this.request('POST', 'tasks.updateDeliverable', input);
  }

  async getTask(input: { taskId: string }): Promise<Task> {
    return this.request('GET', 'tasks.get', input);
  }

  // Probe — lightweight health check via tasks.list
  async probe(timeoutMs: number): Promise<ChannelProbeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `${this.apiUrl}/tasks.list?input=${encodeURIComponent(JSON.stringify({ limit: 1 }))}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bot ${this.botToken}`,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        return { ok: false, error: `HTTP ${response.status}` };
      }
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }
}
