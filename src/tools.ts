/**
 * ClawHouse Agent Tools Implementation
 * 
 * This module implements the ClawHouse integration for OpenClaw agents,
 * providing tools for task management, message sending, and bot collaboration.
 * 
 * Architecture:
 * - Tools are created based on the channel configuration in config.yaml
 * - Each tool validates parameters, calls the ClawHouse API, and returns formatted responses
 * - Error handling provides user-friendly messages with suggestions
 * - All responses follow a consistent JSON structure for agent consumption
 * 
 * Configuration:
 * Tools are only available when ClawHouse is properly configured in channels.clawhouse
 * with botToken and apiUrl. Supports both single account and multi-account setups.
 */

import { ClawHouseClient } from './client';
import { TOOLS } from './llm-definitions';
import type {
  AnyAgentTool,
  OpenClawPluginApi,
  ResolvedClawHouseAccount,
  Task,
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

function formatTaskResponse(task: Task, summary: string, nextActions: string[]): {
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

function formatListResponse(tasks: Task[], summary: string, nextActions: string[]): {
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
  const rawMessage = err instanceof Error ? err.message : String(err);

  // Parse common HTTP error patterns and provide user-friendly messages
  let userMessage = rawMessage;
  let suggestion = '';

  // Check for HTTP error patterns from client.ts
  if (rawMessage.includes('ClawHouse API error: 409')) {
    userMessage = 'Task is already claimed by another bot. Use clawhouse_list_tasks to find available tasks.';
    suggestion = 'Try listing tasks with status="ready_for_bot" to find unclaimed tasks.';
  } else if (rawMessage.includes('ClawHouse API error: 404')) {
    userMessage = 'Task not found. Verify the taskId is correct.';
    suggestion = 'Use clawhouse_list_tasks to see all available tasks and verify the taskId.';
  } else if (rawMessage.includes('authentication failed') || rawMessage.includes('401') || rawMessage.includes('403')) {
    userMessage = 'Authentication failed. Check your bot token configuration.';
    suggestion = 'Verify the bot token in your OpenClaw configuration is correct and has not expired.';
  } else if (rawMessage.includes('server error') || /5\d\d/.test(rawMessage)) {
    userMessage = 'ClawHouse server error. Try again in a moment.';
    suggestion = 'The server encountered an error. Wait a few moments and retry your request.';
  } else if (rawMessage.includes('timed out')) {
    userMessage = 'Request timed out. The server may be busy.';
    suggestion = 'Wait a moment and try again. If the problem persists, check your network connection.';
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: true,
        message: userMessage,
        ...(suggestion ? { suggestion } : {}),
        originalError: rawMessage
      }, null, 2)
    }],
    isError: true,
  };
}

/**
 * Type-safe parameter validation helpers
 * 
 * These functions provide runtime validation of tool parameters with TypeScript
 * type safety. They throw descriptive errors for invalid parameters, which are
 * caught by the tool execution framework and converted to user-friendly messages.
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
 * Creates all ClawHouse agent tools for integration with the ClawHouse task management system.
 * 
 * This function dynamically creates agent tools based on the ClawHouse configuration
 * in the OpenClaw config file. Tools enable agents to:
 * - Claim and release tasks
 * - Update task deliverables and request reviews
 * - Send messages to humans
 * - List and retrieve task information
 * 
 * @param api - OpenClaw plugin API for accessing configuration and runtime
 * @returns Array of agent tools, or null if ClawHouse is not configured
 * 
 * @example
 * // In config.yaml:
 * channels:
 *   clawhouse:
 *     botToken: "your-bot-token"
 *     apiUrl: "https://api.clawhouse.com"
 *     enabled: true
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
          await client.sendMessage({ content, taskId });

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
          await client.updateDeliverable({ taskId, deliverable });

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
