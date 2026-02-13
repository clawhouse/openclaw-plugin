/**
 * Minimal type definitions for the OpenClaw plugin API.
 * These mirror the actual OpenClaw types but are defined inline
 * to avoid a hard dependency on the openclaw package at build time.
 * At runtime, the real types are provided by OpenClaw.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

// Tool types for plugin tool registration
export interface AnyAgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (
    id: string,
    params: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  optional?: boolean;
}

export interface OpenClawPluginToolContext {
  config?: unknown;
  messageChannel?: unknown;
  agentAccountId?: string;
  sandboxed?: boolean;
}

export type OpenClawPluginToolFactory = (
  ctx: OpenClawPluginToolContext,
) => AnyAgentTool | AnyAgentTool[] | null | undefined;

export interface OpenClawPluginToolOptions {
  optional?: boolean;
}

// Plugin API provided by OpenClaw at registration time
export interface OpenClawPluginApi {
  runtime: PluginRuntime;
  config: unknown;
  pluginConfig: unknown;
  logger: PluginLogger;
  registerChannel(registration: { plugin: ChannelPlugin }): void;
  registerHttpRoute(params: {
    path: string;
    handler: (
      req: IncomingMessage,
      res: ServerResponse,
    ) => Promise<void> | void;
  }): void;
  registerTool(
    tool: AnyAgentTool | OpenClawPluginToolFactory,
    opts?: OpenClawPluginToolOptions,
  ): void;
}

// Subset of PluginRuntime we actually use
export interface PluginRuntime {
  config: {
    loadConfig(): unknown;
    writeConfigFile(cfg: unknown): Promise<void>;
  };
  channel: {
    reply: {
      finalizeInboundContext<T extends Record<string, unknown>>(
        ctx: T,
      ): T & FinalizedMsgContext;
      dispatchReplyFromConfig(params: {
        ctx: FinalizedMsgContext;
        cfg: unknown;
        dispatcher: ReplyDispatcher;
        replyOptions?: unknown;
      }): Promise<{ queuedFinal: boolean }>;
      createReplyDispatcherWithTyping(params: {
        channel: string;
        accountId: string;
        deliver: (payload: { text?: string; body?: string }) => Promise<void>;
        [key: string]: unknown;
      }): {
        dispatcher: ReplyDispatcher;
        replyOptions: unknown;
        markDispatchIdle: () => void;
      };
    };
    text: {
      chunkMarkdownText(text: string, limit: number): string[];
    };
  };
  logging: {
    createLogger(name: string): PluginLogger;
  };
  state: {
    resolveStateDir(): string;
  };
}

export interface FinalizedMsgContext {
  Body: string;
  RawBody?: string;
  ChatType: string;
  Provider: string;
  Surface: string;
  From: string;
  To: string;
  MessageSid: string;
  Timestamp?: string;
  BodyForAgent?: string;
  [key: string]: unknown;
}

export interface ReplyDispatcher {
  send(reply: unknown): Promise<void>;
  getQueuedCounts(): unknown;
}

export interface PluginLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
}

// Channel plugin interfaces
export interface ChannelMessagingTargetResolver {
  hint?: string;
  looksLikeId?(raw: string, normalized?: string): boolean;
}

export interface ChannelMessagingAdapter {
  normalizeTarget?(raw: string): string | undefined;
  targetResolver?: ChannelMessagingTargetResolver;
}

export interface ChannelPlugin {
  id: string;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;
  config: ChannelConfigAdapter;
  outbound?: ChannelOutboundAdapter;
  gateway?: ChannelGatewayAdapter;
  setup?: ChannelSetupAdapter;
  security?: ChannelSecurityAdapter;
  messaging?: ChannelMessagingAdapter;
  onboarding?: ChannelOnboardingAdapter;
  status?: ChannelStatusAdapter;
}

export interface ChannelMeta {
  name: string;
  icon?: string;
  description?: string;
}

export interface ChannelCapabilities {
  text: boolean;
  media: boolean;
  reactions: boolean;
  threads: boolean;
  editing: boolean;
}

export interface ChannelConfigAdapter {
  listAccountIds(cfg: unknown): string[];
  resolveAccount(
    cfg: unknown,
    accountId?: string | null,
  ): ResolvedClawHouseAccount;
  isConfigured?(account: ResolvedClawHouseAccount, cfg: unknown): boolean;
  isEnabled?(account: ResolvedClawHouseAccount, cfg: unknown): boolean;
  describeAccount?(
    account: ResolvedClawHouseAccount,
    cfg: unknown,
  ): ChannelAccountSnapshot;
}

export interface ChannelOutboundAdapter {
  deliveryMode: 'direct' | 'gateway' | 'hybrid';
  resolveTarget?(
    target: string,
    ctx: { cfg: unknown; accountId?: string | null },
  ): { to: string } | null;
  sendText?(ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult>;
  textChunkLimit?: number;
  chunkerMode?: 'text' | 'markdown';
}

export interface ChannelGatewayAdapter {
  startAccount?(ctx: ChannelGatewayContext): Promise<unknown>;
  stopAccount?(ctx: ChannelGatewayContext): Promise<void>;
  logoutAccount?(ctx: ChannelLogoutContext): Promise<ChannelLogoutResult>;
}

export interface ChannelGatewayContext {
  cfg: unknown;
  accountId: string;
  account: ResolvedClawHouseAccount;
  runtime: unknown;
  abortSignal: AbortSignal;
  log?: PluginLogger;
  getStatus(): ChannelAccountSnapshot;
  setStatus(next: ChannelAccountSnapshot): void;
}

export interface ChannelSetupAdapter {
  applyAccountConfig(params: {
    cfg: unknown;
    accountId: string;
    input: Record<string, string>;
  }): unknown;
  validateInput?(params: {
    cfg: unknown;
    accountId: string;
    input: Record<string, string>;
  }): string | null;
}

export interface ChannelSecurityDmPolicy {
  policy: string;
  allowFrom?: Array<string | number> | null;
  policyPath?: string;
  allowFromPath: string;
  approveHint: string;
  normalizeEntry?: (raw: string) => string;
}

export interface ChannelSecurityAdapter {
  resolveDmPolicy?(ctx: {
    cfg: unknown;
    accountId?: string | null;
    account: ResolvedClawHouseAccount;
  }): ChannelSecurityDmPolicy | null;
  collectWarnings?(ctx: {
    cfg: unknown;
    accountId?: string | null;
    account: ResolvedClawHouseAccount;
  }): Promise<string[]> | string[];
}

export interface ChannelOutboundContext {
  cfg: unknown;
  to: string;
  text: string;
  threadId?: string | number | null;
  replyToId?: string | null;
  accountId?: string | null;
}

export interface OutboundDeliveryResult {
  channel: string;
  success: boolean;
  threadId?: string;
}

export interface ChannelAccountSnapshot {
  accountId?: string;
  enabled?: boolean;
  configured?: boolean;
  running?: boolean;
  lastStartAt?: number;
  lastStopAt?: number;
  lastError?: string;
  probe?: ChannelProbeResult;
}

// ClawHouse-specific types

export interface ResolvedClawHouseAccount {
  accountId: string;
  botToken: string;
  apiUrl: string;
  wsUrl: string;
  userId: string;
  enabled: boolean;
}

export interface ClawHouseChannelConfig {
  enabled?: boolean;
  botToken: string;
  apiUrl: string;
  wsUrl: string;
  userId: string;
  accounts?: Record<string, Omit<ClawHouseChannelConfig, 'accounts'>>;
}

// Chat message returned by the messages API
export interface ChatMessageAttachment {
  name: string;
  contentType: string;
  size: number;
  url: string; // signed S3 download URL
}

export interface ChatMessage {
  messageId: string;
  botId: string;
  userId: string;
  authorType: 'bot' | 'user';
  content: string;
  attachments?: ChatMessageAttachment[];
  taskId?: string | null;
  createdAt: string;
  userName?: string | null;
  botName?: string | null;
}

export interface MessagesResponse {
  items: ChatMessage[];
  cursor: string | null;
  hasMore: boolean;
}

export interface WsTicketResponse {
  ticket: string;
  wsUrl: string;
  expiresAt: string;
}

// Wizard prompter for onboarding flows
export interface WizardPrompter {
  text(params: {
    message: string;
    initialValue?: string;
    placeholder?: string;
    validate?: (value: string) => string | undefined;
  }): Promise<string>;
  confirm(params: {
    message: string;
    initialValue?: boolean;
  }): Promise<boolean>;
  note(message: string, title?: string): Promise<void>;
}

// Onboarding adapter types
export interface ChannelOnboardingStatus {
  channel: string;
  configured: boolean;
  statusLines: string[];
  selectionHint?: string;
  quickstartScore?: number;
}

export interface ChannelOnboardingResult {
  cfg: unknown;
  accountId?: string;
}

export interface ChannelOnboardingAdapter {
  channel: string;
  getStatus(ctx: { cfg: unknown }): Promise<ChannelOnboardingStatus>;
  configure(ctx: {
    cfg: unknown;
    runtime: unknown;
    prompter: WizardPrompter;
    accountOverrides: Record<string, string>;
    shouldPromptAccountIds: boolean;
    forceAllowFrom: boolean;
  }): Promise<ChannelOnboardingResult>;
  disable?(cfg: unknown): unknown;
}

// Status adapter types
export interface ChannelProbeResult {
  ok: boolean;
  error?: string;
}

export interface ChannelStatusIssue {
  channel: string;
  accountId: string;
  kind: 'config' | 'auth' | 'runtime';
  message: string;
  fix?: string;
}

export interface ChannelStatusAdapter {
  probeAccount?(params: {
    account: ResolvedClawHouseAccount;
    timeoutMs: number;
    cfg: unknown;
  }): Promise<ChannelProbeResult>;
  buildAccountSnapshot?(params: {
    account: ResolvedClawHouseAccount;
    cfg: unknown;
    runtime?: ChannelAccountSnapshot;
    probe?: ChannelProbeResult;
  }): ChannelAccountSnapshot;
  collectStatusIssues?(
    accounts: ChannelAccountSnapshot[],
  ): ChannelStatusIssue[];
}

// Logout types
export interface ChannelLogoutContext {
  cfg: unknown;
  accountId: string;
  account: ResolvedClawHouseAccount;
  runtime: unknown;
  log?: PluginLogger;
}

export interface ChannelLogoutResult {
  cleared: boolean;
  loggedOut?: boolean;
  [key: string]: unknown;
}

// WebSocket notification payload (thin — just a poke)
export interface WsNotification {
  action: 'notify';
  hint: string;
}

// ClawHouse API response types
export interface Task {
  taskId: string;
  title: string;
  status: 'ready_for_bot' | 'working_on_it' | 'waiting_for_human' | 'done';
  instructions?: string;
  createdAt: string;
  updatedAt: string;
  botId?: string | null;
  userId: string;
  reason?: string | null;
  deliverable?: string | null;
}

export interface Bot {
  userId: string;
  name: string;
  description?: string | null;
  isBot: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdById: string;
}

export interface TasksListResponse {
  tasks: Task[];
}

export interface CreateTaskResponse {
  task: Task;
}

export interface GetBotTokenResponse {
  token: string;
  userId: string;
}

export interface CreateBotResponse {
  bot: Bot;
  token: string;
  userId: string;
}
