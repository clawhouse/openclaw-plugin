import { ClawHouseClient } from './client';
import { TOOLS } from './llm-definitions';
import type {
  AnyAgentTool,
  OpenClawPluginApi,
  ResolvedClawHouseAccount,
} from './types';

/**
 * Valid task status values for filtering
 */
const VALID_TASK_STATUSES = ['ready_for_bot', 'working_on_it', 'waiting_for_human', 'done'] as const;
type TaskStatus = typeof VALID_TASK_STATUSES[number];

/**
 * Resolve the ClawHouse account from the plugin config.
 * Shared logic with channel.ts — reads channels.clawhouse from config.
 */
function resolveAccountFromConfig(
  api: OpenClawPluginApi,
): ResolvedClawHouseAccount | null {
  const cfg = api.runtime.config.loadConfig();

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

function formatTaskResponse(task: any, summary: string, nextActions: string[]): {
  content: Array<{ type: string; text: string }>;
} {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        summary,
        nextActions,
        task
      }, null, 2)
    }]
  };
}

function formatListResponse(tasks: any[], summary: string, nextActions: string[]): {
  content: Array<{ type: string; text: string }>;
} {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        summary,
        nextActions,
        tasks
      }, null, 2)
    }]
  };
}

function formatConfirmation(summary: string, nextActions: string[], data?: unknown): {
  content: Array<{ type: string; text: string }>;
} {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        summary,
        nextActions,
        ...(data ? { data } : {})
      }, null, 2)
    }]
  };
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

function validateNumberParam(
  params: Record<string, unknown>, 
  key: string, 
  required: true
): number;
function validateNumberParam(
  params: Record<string, unknown>, 
  key: string, 
  required: false
): number | undefined;
function validateNumberParam(
  params: Record<string, unknown>, 
  key: string, 
  required: boolean,
  options?: { min?: number; max?: number; integer?: boolean }
): number | undefined {
  const value = params[key];
  
  if (value == null) {
    if (required) {
      throw new Error(`Required parameter '${key}' is missing`);
    }
    return undefined;
  }
  
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  
  if (typeof numValue !== 'number' || isNaN(numValue)) {
    throw new Error(`Parameter '${key}' must be a valid number, got ${typeof value}: ${value}`);
  }
  
  if (options?.min !== undefined && numValue < options.min) {
    throw new Error(`Parameter '${key}' must be >= ${options.min}, got ${numValue}`);
  }
  
  if (options?.max !== undefined && numValue > options.max) {
    throw new Error(`Parameter '${key}' must be <= ${options.max}, got ${numValue}`);
  }
  
  if (options?.integer && !Number.isInteger(numValue)) {
    throw new Error(`Parameter '${key}' must be an integer, got ${numValue}`);
  }
  
  return numValue;
}

function validateBooleanParam(
  params: Record<string, unknown>, 
  key: string, 
  required: true
): boolean;
function validateBooleanParam(
  params: Record<string, unknown>, 
  key: string, 
  required: false
): boolean | undefined;
function validateBooleanParam(
  params: Record<string, unknown>, 
  key: string, 
  required: boolean
): boolean | undefined {
  const value = params[key];
  
  if (value == null) {
    if (required) {
      throw new Error(`Required parameter '${key}' is missing`);
    }
    return undefined;
  }
  
  if (typeof value === 'boolean') {
    return value;
  }
  
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (lower === 'true' || lower === '1' || lower === 'yes' || lower === 'on') {
      return true;
    }
    if (lower === 'false' || lower === '0' || lower === 'no' || lower === 'off') {
      return false;
    }
  }
  
  throw new Error(`Parameter '${key}' must be a boolean (true/false), got ${typeof value}: ${value}`);
}

function validateEnumParam<T extends string>(
  params: Record<string, unknown>,
  key: string,
  allowedValues: readonly T[],
  required: true
): T;
function validateEnumParam<T extends string>(
  params: Record<string, unknown>,
  key: string,
  allowedValues: readonly T[],
  required: false
): T | undefined;
function validateEnumParam<T extends string>(
  params: Record<string, unknown>,
  key: string,
  allowedValues: readonly T[],
  required: boolean
): T | undefined {
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
  
  if (!allowedValues.includes(value as T)) {
    throw new Error(`Parameter '${key}' must be one of: ${allowedValues.join(', ')}, got: ${value}`);
  }
  
  return value as T;
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
      ...TOOLS.GET_TASK,
      async execute(_id, params) {
        try {
          const taskId = validateStringParam(params, 'taskId', true);
          const result = await client.getTask({ taskId });

          const nextActions: string[] = [];
          if (result.status === 'ready_for_bot') {
            nextActions.push('You can claim this task with clawhouse_claim_task');
          } else if (result.status === 'working_on_it' && result.botId) {
            nextActions.push('Update deliverable with clawhouse_update_deliverable');
            nextActions.push('Request review when ready with clawhouse_request_review');
          } else if (result.status === 'waiting_for_human') {
            nextActions.push('Wait for human review or send a message with clawhouse_send_message');
          }

          return formatTaskResponse(
            result,
            `Task "${result.title}" is ${result.status}`,
            nextActions
          );
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

          return formatTaskResponse(
            result,
            `Successfully claimed task "${result.title}"`,
            [
              'Use clawhouse_get_task to get full task context',
              'Work on the task and update deliverable with clawhouse_update_deliverable',
              'Request review when done with clawhouse_request_review'
            ]
          );
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

          return formatTaskResponse(
            result,
            `Released task "${result.title}"`,
            [
              'Task is now available for other bots to claim',
              'Use clawhouse_list_tasks to find other tasks'
            ]
          );
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

          return formatConfirmation(
            `Message sent${taskId ? ` to task ${taskId}` : ''}`,
            [
              'Message delivered to the human',
              taskId ? 'Continue working on the task or wait for response' : 'Check for response with task messages'
            ]
          );
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

          return formatConfirmation(
            `Updated deliverable for task ${taskId}`,
            [
              'Deliverable has been saved',
              'Continue working or request review with clawhouse_request_review when ready'
            ]
          );
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

          return formatTaskResponse(
            result,
            `Submitted task "${result.title}" for review`,
            [
              'Task is now waiting for human review',
              'Remember to terminate any sub-agents working on this task',
              'You can send additional messages with clawhouse_send_message'
            ]
          );
        } catch (err) {
          return errorResult(err);
        }
      },
    },
    {
      ...TOOLS.LIST_TASKS,
      async execute(_id, params) {
        try {
          const status = validateEnumParam(params, 'status', VALID_TASK_STATUSES, false);
          const result = await client.listTasks({ status });

          const readyForBot = result.tasks.filter(t => t.status === 'ready_for_bot');
          const nextActions: string[] = [];

          if (readyForBot.length > 0) {
            nextActions.push(`${readyForBot.length} task(s) ready for bot - claim one with clawhouse_claim_task`);
          } else {
            nextActions.push('No tasks ready for bot. Create a new task with clawhouse_create_task if needed');
          }

          return formatListResponse(
            result.tasks,
            `Found ${result.tasks.length} task(s)${status ? ` with status "${status}"` : ''} (${readyForBot.length} ready for bot)`,
            nextActions
          );
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

          return formatTaskResponse(
            result.task,
            `Created task "${result.task.title}" with ID ${result.task.taskId}`,
            [
              'Claim this task with clawhouse_claim_task to start working on it',
              'Or list all tasks with clawhouse_list_tasks'
            ]
          );
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

**Flow:** \`clawhouse_create_task\` → \`clawhouse_claim_task\` → spawn sub-agent → work + updates → \`clawhouse_request_review\`

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
