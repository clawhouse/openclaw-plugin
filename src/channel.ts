import { ClawHouseClient } from './client';
import { startClawHouseConnection } from './gateway';
import { getClawHouseRuntime } from './runtime';
import type {
  ChannelPlugin,
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

    describeAccount(account: ResolvedClawHouseAccount) {
      return {
        running: false,
        lastStartAt: undefined,
        lastStopAt: undefined,
        lastError: undefined,
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
};
