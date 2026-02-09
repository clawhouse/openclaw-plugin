import { ClawHouseClient } from './client';
import { startClawHouseConnection } from './gateway';
import { getClawHouseRuntime } from './runtime';
import type {
  ChannelAccountSnapshot,
  ChannelLogoutContext,
  ChannelPlugin,
  ChannelProbeResult,
  ClawHouseChannelConfig,
  ResolvedClawHouseAccount,
} from './types';

function getChannelConfig(cfg: unknown): ClawHouseChannelConfig | null {
  const c = cfg as { channels?: { clawhouse?: ClawHouseChannelConfig } };
  return c?.channels?.clawhouse ?? null;
}

export const clawHousePlugin: ChannelPlugin = {
  id: 'clawhouse',

  meta: {
    name: 'ClawHouse',
    description: '1:1 messaging channel for ClawHouse bots',
  },

  capabilities: {
    text: true,
    media: false,
    reactions: false,
    threads: true,
    editing: false,
  },

  config: {
    listAccountIds(cfg: unknown): string[] {
      const ch = getChannelConfig(cfg);
      if (!ch) return [];
      if (ch.accounts && Object.keys(ch.accounts).length > 0) {
        return Object.keys(ch.accounts);
      }
      return ['default'];
    },

    resolveAccount(
      cfg: unknown,
      accountId?: string | null,
    ): ResolvedClawHouseAccount {
      const ch = getChannelConfig(cfg);
      if (!ch) {
        return {
          accountId: accountId ?? 'default',
          botToken: '',
          apiUrl: '',
          wsUrl: '',
          enabled: false,
        };
      }

      const id = accountId ?? 'default';
      const acct = id !== 'default' && ch.accounts?.[id] ? ch.accounts[id] : ch;

      return {
        accountId: id,
        botToken: acct.botToken ?? '',
        apiUrl: acct.apiUrl ?? '',
        wsUrl: acct.wsUrl ?? '',
        enabled: acct.enabled !== false,
      };
    },

    isConfigured(account: ResolvedClawHouseAccount): boolean {
      return Boolean(account.botToken && account.apiUrl);
    },

    isEnabled(account: ResolvedClawHouseAccount): boolean {
      return account.enabled;
    },

    describeAccount(account: ResolvedClawHouseAccount, cfg: unknown): ChannelAccountSnapshot {
      const isConfigured = Boolean(account.botToken && account.apiUrl);
      return {
        accountId: account.accountId,
        enabled: account.enabled,
        configured: isConfigured,
      };
    },
  },

  outbound: {
    deliveryMode: 'direct',
    chunkerMode: 'markdown',
    textChunkLimit: 2000,

    async sendText(ctx) {
      const runtime = getClawHouseRuntime();
      const cfg = runtime.config.loadConfig();
      const ch = getChannelConfig(cfg);
      if (!ch) {
        return { channel: 'clawhouse', success: false };
      }

      const acct = clawHousePlugin.config.resolveAccount(cfg, ctx.accountId);
      const client = new ClawHouseClient(acct.botToken, acct.apiUrl);

      try {
        await client.sendMessage({
          userId: ctx.to,
          content: ctx.text,
          taskId: ctx.threadId ? String(ctx.threadId) : undefined,
        });
        return {
          channel: 'clawhouse',
          success: true,
          threadId: ctx.threadId ? String(ctx.threadId) : undefined,
        };
      } catch {
        return { channel: 'clawhouse', success: false };
      }
    },
  },

  gateway: {
    async startAccount(ctx) {
      return startClawHouseConnection(ctx);
    },

    async stopAccount(ctx) {
      const log = ctx.log ?? getClawHouseRuntime().logging.createLogger('clawhouse');
      log.info(`Stopping ClawHouse account ${ctx.accountId}`);
      ctx.setStatus({ running: false, lastStopAt: Date.now() });
    },

    async logoutAccount(ctx: ChannelLogoutContext) {
      const log = ctx.log ?? getClawHouseRuntime().logging.createLogger('clawhouse');
      const runtime = ctx.runtime as { config: { writeConfigFile(cfg: unknown): Promise<void> } };

      // Clone config immutably
      const config = JSON.parse(JSON.stringify(ctx.cfg)) as Record<string, unknown>;
      const channels = (config.channels ?? {}) as Record<string, unknown>;
      const clawhouse = (channels.clawhouse ?? {}) as Record<string, unknown>;

      if (ctx.accountId === 'default') {
        delete clawhouse.botToken;
      } else {
        const accounts = (clawhouse.accounts ?? {}) as Record<string, Record<string, unknown>>;
        if (accounts[ctx.accountId]) {
          delete accounts[ctx.accountId].botToken;
        }
      }

      channels.clawhouse = clawhouse;
      config.channels = channels;

      await runtime.config.writeConfigFile(config);
      log.info(`Cleared bot token for account ${ctx.accountId}`);

      return { cleared: true, loggedOut: true };
    },
  },

  setup: {
    applyAccountConfig(params) {
      const { cfg, accountId, input } = params;
      const config = cfg as Record<string, unknown>;
      const channels = (config.channels ?? {}) as Record<string, unknown>;
      const clawhouse = (channels.clawhouse ?? {}) as Record<string, unknown>;

      if (accountId === 'default') {
        clawhouse.botToken = input.botToken;
        clawhouse.apiUrl = input.apiUrl;
        clawhouse.wsUrl = input.wsUrl;
        clawhouse.enabled = true;
      } else {
        const accounts = (clawhouse.accounts ?? {}) as Record<string, unknown>;
        accounts[accountId] = {
          botToken: input.botToken,
          apiUrl: input.apiUrl,
          wsUrl: input.wsUrl,
          enabled: true,
        };
        clawhouse.accounts = accounts;
      }

      channels.clawhouse = clawhouse;
      config.channels = channels;
      return config;
    },

    validateInput(params) {
      const { input } = params;
      if (!input.botToken?.startsWith('bot_')) {
        return 'Bot token must start with "bot_"';
      }
      if (!input.apiUrl) {
        return 'API URL is required';
      }
      if (!input.wsUrl) {
        return 'WebSocket URL is required';
      }
      return null;
    },
  },

  security: {
    resolveDmPolicy() {
      return { policy: 'open' };
    },
  },

  onboarding: {
    channel: 'clawhouse',

    async getStatus(ctx) {
      const ch = getChannelConfig(ctx.cfg);
      const hasBotToken = Boolean(ch?.botToken);
      const hasApiUrl = Boolean(ch?.apiUrl);
      const configured = hasBotToken && hasApiUrl;

      const statusLines: string[] = [];
      if (configured) {
        statusLines.push('Bot token: configured');
        statusLines.push(`API URL: ${ch!.apiUrl}`);
        if (ch!.wsUrl) statusLines.push(`WS URL: ${ch!.wsUrl}`);
      } else {
        statusLines.push('Not configured');
      }

      return {
        channel: 'clawhouse',
        configured,
        statusLines,
        selectionHint: 'Connect to a ClawHouse instance for 1:1 bot messaging',
        quickstartScore: configured ? 0 : 50,
      };
    },

    async configure(ctx) {
      const ch = getChannelConfig(ctx.cfg);
      const accountId = ctx.accountOverrides.accountId ?? 'default';

      const botToken = await ctx.prompter.text({
        message: 'Bot token',
        initialValue: ch?.botToken ?? '',
        placeholder: 'bot_xxxxxxxxxxxxxxxx',
        validate: (v) => (v.startsWith('bot_') ? undefined : 'Must start with "bot_"'),
      });

      const apiUrl = await ctx.prompter.text({
        message: 'API URL',
        initialValue: ch?.apiUrl ?? '',
        placeholder: 'https://api.clawhouse.net/v1/bot',
        validate: (v) => (v.startsWith('http') ? undefined : 'Must start with http:// or https://'),
      });

      const wsUrl = await ctx.prompter.text({
        message: 'WebSocket URL',
        initialValue: ch?.wsUrl ?? '',
        placeholder: 'wss://ws.clawhouse.net',
        validate: (v) => (v.startsWith('ws') ? undefined : 'Must start with ws:// or wss://'),
      });

      const updatedCfg = clawHousePlugin.setup!.applyAccountConfig({
        cfg: ctx.cfg,
        accountId,
        input: { botToken, apiUrl, wsUrl },
      });

      await ctx.prompter.note('ClawHouse channel configured.', 'Done');

      return { cfg: updatedCfg, accountId };
    },

    disable(cfg: unknown) {
      const config = JSON.parse(JSON.stringify(cfg)) as Record<string, unknown>;
      const channels = (config.channels ?? {}) as Record<string, unknown>;
      const clawhouse = (channels.clawhouse ?? {}) as Record<string, unknown>;
      clawhouse.enabled = false;
      channels.clawhouse = clawhouse;
      config.channels = channels;
      return config;
    },
  },

  status: {
    async probeAccount(params) {
      const isConfigured = Boolean(params.account.botToken && params.account.apiUrl);
      if (!isConfigured) {
        return { ok: false, error: 'Account not configured' };
      }
      const client = new ClawHouseClient(params.account.botToken, params.account.apiUrl);
      return client.probe(params.timeoutMs);
    },

    buildAccountSnapshot(params): ChannelAccountSnapshot {
      const isConfigured = Boolean(params.account.botToken && params.account.apiUrl);
      return {
        accountId: params.account.accountId,
        enabled: params.account.enabled,
        configured: isConfigured,
        running: params.runtime?.running,
        lastStartAt: params.runtime?.lastStartAt,
        lastStopAt: params.runtime?.lastStopAt,
        lastError: params.runtime?.lastError,
        probe: params.probe,
      };
    },

    collectStatusIssues(accounts) {
      const issues: import('./types').ChannelStatusIssue[] = [];

      for (const snap of accounts) {
        const id = snap.accountId ?? 'unknown';

        if (!snap.configured) {
          issues.push({
            channel: 'clawhouse',
            accountId: id,
            kind: 'config',
            message: 'Account is not configured',
            fix: 'Run onboarding to set bot token and API URL',
          });
          continue;
        }

        if (!snap.enabled) {
          issues.push({
            channel: 'clawhouse',
            accountId: id,
            kind: 'config',
            message: 'Account is disabled',
            fix: 'Set enabled: true in config',
          });
          continue;
        }

        if (!snap.running) {
          issues.push({
            channel: 'clawhouse',
            accountId: id,
            kind: 'runtime',
            message: 'Gateway is not running',
          });
        }

        if (snap.probe && !snap.probe.ok) {
          issues.push({
            channel: 'clawhouse',
            accountId: id,
            kind: 'auth',
            message: `Probe failed: ${snap.probe.error ?? 'unknown error'}`,
            fix: 'Check bot token and API URL',
          });
        }
      }

      return issues;
    },
  },
};
