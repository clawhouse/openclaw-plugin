import { ClawHouseClient } from './client';
import { TOOLS } from './llm-definitions';
import type {
  AnyAgentTool,
  OpenClawPluginApi,
  ResolvedClawHouseAccount,
} from './types';

/**
 * Resolve the ClawHouse account from the plugin config.
 * Shared logic with channel.ts — reads channels.clawhouse from config.
 */
function resolveAccountFromConfig(
  api: OpenClawPluginApi,
): ResolvedClawHouseAccount | null {
  const cfg = api.runtime.config.loadConfig() as {
    channels?: {
      clawhouse?: {
        botToken?: string;
        apiUrl?: string;
        wsUrl?: string;
        userId?: string;
        enabled?: boolean;
        accounts?: Record<
          string,
          {
            botToken?: string;
            apiUrl?: string;
            wsUrl?: string;
            userId?: string;
            enabled?: boolean;
          }
        >;
      };
    };
  };

  const ch = cfg?.channels?.clawhouse;
  if (!ch) return null;

  // Use first explicit account, or fall back to top-level config
  if (ch.accounts && Object.keys(ch.accounts).length > 0) {
    const [accountId, acct] = Object.entries(ch.accounts)[0];
    if (!acct.botToken || !acct.apiUrl) return null;
    return {
      accountId,
      botToken: acct.botToken,
      apiUrl: acct.apiUrl,
      wsUrl: acct.wsUrl ?? '',
      userId: acct.userId ?? '',
      enabled: acct.enabled !== false,
    };
  }

  if (!ch.botToken || !ch.apiUrl) return null;
  return {
    accountId: 'default',
    botToken: ch.botToken,
    apiUrl: ch.apiUrl,
    wsUrl: ch.wsUrl ?? '',
    userId: ch.userId ?? '',
    enabled: ch.enabled !== false,
  };
}

function textResult(data: unknown): {
  content: Array<{ type: string; text: string }>;
} {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(err: unknown): {
  content: Array<{ type: string; text: string }>;
  isError: true;
} {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: true, message }) }],
    isError: true,
  };
}

/**
 * Type-safe parameter validation helpers
 */
function validateStringParam(
  params: Record<string, unknown>, 
  key: string, 
  required: true
): string;
function validateStringParam(
  params: Record<string, unknown>, 
  key: string, 
  required: false
): string | undefined;
function validateStringParam(
  params: Record<string, unknown>, 
  key: string, 
  required: boolean
): string | undefined {
  const value = params[key];
  
  if (value == null) {
    if (required) {
      throw new Error(`Required parameter '${key}' is missing`);
    }
    return undefined;
  }
  
  if (typeof value !== 'string') {
    throw new Error(`Parameter '${key}' must be a string, got ${typeof value}`);
  }
  
  if (required && value.trim() === '') {
    throw new Error(`Required parameter '${key}' cannot be empty`);
  }
  
  return value;
}

/**
 * Creates all ClawHouse agent tools.
 * Returns null if the channel is not configured.
 */
export function createClawHouseTools(
  api: OpenClawPluginApi,
): AnyAgentTool[] | null {
  const account = resolveAccountFromConfig(api);
  if (!account) return null;

  const client = new ClawHouseClient(account.botToken, account.apiUrl);

  return [
    {
      ...TOOLS.GET_NEXT_TASK,
      async execute(_id, params) {
        try {
          const result = await client.getNextTask();
          return textResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      ...TOOLS.GET_TASK,
      async execute(_id, params) {
        try {
          const taskId = validateStringParam(params, 'taskId', true);
          const result = await client.getTask({ taskId });
          return textResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      ...TOOLS.CLAIM_TASK,
      async execute(_id, params) {
        try {
          const taskId = validateStringParam(params, 'taskId', true);
          const result = await client.claimTask({ taskId });
          return textResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      ...TOOLS.RELEASE_TASK,
      async execute(_id, params) {
        try {
          const taskId = validateStringParam(params, 'taskId', true);
          const result = await client.releaseTask({ taskId });
          return textResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      ...TOOLS.SEND_MESSAGE,
      async execute(_id, params) {
        try {
          const content = validateStringParam(params, 'content', true);
          const taskId = validateStringParam(params, 'taskId', false);
          const result = await client.sendMessage({ content, taskId });
          return textResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      ...TOOLS.UPDATE_DELIVERABLE,
      async execute(_id, params) {
        try {
          const taskId = validateStringParam(params, 'taskId', true);
          const deliverable = validateStringParam(params, 'deliverable', true);
          const result = await client.updateDeliverable({ taskId, deliverable });
          return textResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      ...TOOLS.REQUEST_REVIEW,
      async execute(_id, params) {
        try {
          const taskId = validateStringParam(params, 'taskId', true);
          const comment = validateStringParam(params, 'comment', false);
          const result = await client.requestReview({ taskId, comment });
          return textResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      ...TOOLS.LIST_TASKS,
      async execute(_id, params) {
        try {
          const status = validateStringParam(params, 'status', false);
          const result = await client.listTasks({ status });
          return textResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      ...TOOLS.DONE,
      async execute(_id, params) {
        try {
          const taskId = validateStringParam(params, 'taskId', true);
          const reason = validateStringParam(params, 'reason', true);
          const deliverable = validateStringParam(params, 'deliverable', true);
          const result = await client.done({ taskId, reason, deliverable });
          return textResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      ...TOOLS.GIVEUP,
      async execute(_id, params) {
        try {
          const taskId = validateStringParam(params, 'taskId', true);
          const reason = validateStringParam(params, 'reason', true);
          const deliverable = validateStringParam(params, 'deliverable', true);
          const result = await client.giveup({ taskId, reason, deliverable });
          return textResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      ...TOOLS.CREATE_TASK,
      async execute(_id, params) {
        try {
          const title = validateStringParam(params, 'title', true);
          const instructions = validateStringParam(params, 'instructions', false);
          const result = await client.createTask({ title, instructions });
          return textResult(result);
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      ...TOOLS.SETUP,
      async execute() {
        const directive = `## ClawHouse Task Tracking
<!-- clawhouse-directive -->
When ClawHouse is connected, create a task before starting any non-trivial work. This gives your human visibility into what you're doing.

**Flow:** \`clawhouse_create_task\` → \`clawhouse_get_next_task\` (claims it) → work + \`clawhouse_comment\` updates → \`clawhouse_done\` or \`clawhouse_giveup\`

**Exempt:** Quick one-liners, simple lookups, config changes — anything that takes seconds.

See the clawhouse skill for full details.`;

        return textResult({
          directive,
          instructions:
            'Read your AGENTS.md file. If it does not contain the marker <!-- clawhouse-directive -->, append the directive block above to the end of the file. If the marker already exists, no changes are needed.',
        });
      },
    },
  ];
}
