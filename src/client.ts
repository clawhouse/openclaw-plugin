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

/** Enhanced error class for ClawHouse API errors with user-friendly messages */
export class ClawHouseError extends Error {
  public readonly type: 'network' | 'auth' | 'server' | 'client' | 'timeout' | 'invalid_response';
  public readonly statusCode?: number;
  public readonly userMessage: string;
  public readonly procedure: string;

  constructor(
    type: ClawHouseError['type'],
    procedure: string,
    message: string,
    userMessage: string,
    statusCode?: number,
  ) {
    super(message);
    this.name = 'ClawHouseError';
    this.type = type;
    this.procedure = procedure;
    this.userMessage = userMessage;
    this.statusCode = statusCode;
  }

  static fromResponse(response: Response, procedure: string, responseText: string): ClawHouseError {
    const status = response.status;
    const statusText = response.statusText;

    if (status === 401) {
      return new ClawHouseError(
        'auth',
        procedure,
        `Authentication failed: ${status} ${statusText} — ${responseText}`,
        'Your bot token is invalid or has expired. Please check your authentication credentials.',
        status
      );
    }
    
    if (status === 403) {
      return new ClawHouseError(
        'auth',
        procedure,
        `Authorization failed: ${status} ${statusText} — ${responseText}`,
        'Your bot does not have permission to perform this action. Contact your administrator.',
        status
      );
    }
    
    if (status >= 500) {
      return new ClawHouseError(
        'server',
        procedure,
        `Server error: ${status} ${statusText} — ${responseText}`,
        'ClawHouse service is temporarily unavailable. Please try again in a few minutes.',
        status
      );
    }
    
    if (status === 429) {
      return new ClawHouseError(
        'client',
        procedure,
        `Rate limit exceeded: ${status} ${statusText} — ${responseText}`,
        'Too many requests. Please wait a moment before trying again.',
        status
      );
    }

    if (status === 400) {
      return new ClawHouseError(
        'client',
        procedure,
        `Bad request: ${status} ${statusText} — ${responseText}`,
        'The request was invalid. Please check your input and try again.',
        status
      );
    }

    return new ClawHouseError(
      'client',
      procedure,
      `HTTP error: ${status} ${statusText} — ${responseText}`,
      `Request failed with error ${status}. Please try again or contact support if the problem persists.`,
      status
    );
  }

  static timeout(procedure: string, timeoutMs: number): ClawHouseError {
    return new ClawHouseError(
      'timeout',
      procedure,
      `Request to ${procedure} timed out after ${timeoutMs}ms`,
      'The request took too long to complete. Please check your network connection and try again.'
    );
  }

  static invalidResponse(procedure: string): ClawHouseError {
    return new ClawHouseError(
      'invalid_response',
      procedure,
      `Invalid tRPC response structure for ${procedure}`,
      'Received an unexpected response from the server. Please try again or contact support.'
    );
  }

  static network(procedure: string, originalError: Error): ClawHouseError {
    return new ClawHouseError(
      'network',
      procedure,
      `Network error for ${procedure}: ${originalError.message}`,
      'Unable to connect to ClawHouse. Please check your internet connection and try again.'
    );
  }
}

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

        throw ClawHouseError.fromResponse(response, procedure, text);
      }

      const json = (await response.json()) as { result?: { data?: T } };

      // Validate tRPC response structure
      if (!json.result || json.result.data === undefined) {
        throw ClawHouseError.invalidResponse(procedure);
      }

      return json.result.data;
    } catch (err) {
      if (err instanceof ClawHouseError) {
        throw err;
      }
      
      if (err instanceof Error && err.name === 'AbortError') {
        throw ClawHouseError.timeout(procedure, this.requestTimeoutMs);
      }
      
      if (err instanceof Error) {
        // Network or other fetch errors
        throw ClawHouseError.network(procedure, err);
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
        // Provide more user-friendly probe error messages
        if (response.status === 401 || response.status === 403) {
          return { ok: false, error: 'Authentication failed - check bot token' };
        }
        if (response.status >= 500) {
          return { ok: false, error: 'ClawHouse server unavailable' };
        }
        return { ok: false, error: `HTTP ${response.status} - ${response.statusText}` };
      }
      
      return { ok: true };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, error: `Connection timeout after ${timeoutMs}ms` };
      }
      
      const message = err instanceof Error ? err.message : String(err);
      // Simplify network errors for probe results
      if (message.includes('fetch')) {
        return { ok: false, error: 'Network connection failed' };
      }
      
      return { ok: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }
}
