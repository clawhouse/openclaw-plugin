import type {
  ChannelProbeResult,
  MessagesResponse,
  WsTicketResponse,
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

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bot ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: method === 'POST' ? JSON.stringify(input) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(
          `ClawHouse API timeout: ${procedure} did not respond within ${this.requestTimeoutMs}ms`,
        );
      }
      throw err;
    }
    clearTimeout(timer);

    if (!response.ok) {
      const text = await response.text().catch(() => 'unknown error');
      throw new Error(
        `ClawHouse API error: ${response.status} ${response.statusText} — ${text}`,
      );
    }

    const json = (await response.json()) as { result?: { data: T } };
    return json.result?.data as T;
  }

  // Messages
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
  }): Promise<unknown> {
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
  async comment(input: { taskId: string; content: string }): Promise<unknown> {
    return this.request('POST', 'tasks.comment', input);
  }

  async createTask(input: {
    projectId: string;
    title: string;
    instructions?: string;
  }): Promise<unknown> {
    return this.request('POST', 'tasks.create', input);
  }

  async listTasks(input: {
    projectId: string;
    status?: string;
  }): Promise<unknown[]> {
    return this.request('GET', 'tasks.list', input);
  }

  async done(input: {
    taskId: string;
    reason: string;
    deliverable?: string;
  }): Promise<unknown> {
    return this.request('POST', 'tasks.done', input);
  }

  async giveup(input: {
    taskId: string;
    reason: string;
    deliverable?: string;
  }): Promise<unknown> {
    return this.request('POST', 'tasks.giveup', input);
  }

  async getNextTask(input?: { projectId?: string }): Promise<unknown> {
    return this.request('POST', 'tasks.getNextTask', input ?? {});
  }

  async listProjects(): Promise<unknown[]> {
    return this.request('GET', 'projects.list', {});
  }

  async createProject(input: {
    name: string;
    key: string;
    description?: string;
    color?: string;
  }): Promise<unknown> {
    return this.request('POST', 'projects.create', input);
  }

  // Probe — lightweight health check via projects.list
  async probe(timeoutMs: number): Promise<ChannelProbeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        `${this.apiUrl}/projects.list?input=${encodeURIComponent(JSON.stringify({}))}`,
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
