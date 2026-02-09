import { Type } from '@sinclair/typebox';

import { ClawHouseClient } from './client';
import type { AnyAgentTool, OpenClawPluginApi, ResolvedClawHouseAccount } from './types';

/**
 * Resolve the ClawHouse account from the plugin config.
 * Shared logic with channel.ts — reads channels.clawhouse from config.
 */
function resolveAccountFromConfig(api: OpenClawPluginApi): ResolvedClawHouseAccount | null {
  const cfg = api.runtime.config.loadConfig() as {
    channels?: {
      clawhouse?: {
        botToken?: string;
        apiUrl?: string;
        wsUrl?: string;
        enabled?: boolean;
        accounts?: Record<
          string,
          { botToken?: string; apiUrl?: string; wsUrl?: string; enabled?: boolean }
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
      enabled: acct.enabled !== false,
    };
  }

  if (!ch.botToken || !ch.apiUrl) return null;
  return {
    accountId: 'default',
    botToken: ch.botToken,
    apiUrl: ch.apiUrl,
    wsUrl: ch.wsUrl ?? '',
    enabled: ch.enabled !== false,
  };
}

function textResult(data: unknown): { content: Array<{ type: string; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

/**
 * Creates all ClawHouse agent tools.
 * Returns null if the channel is not configured.
 */
export function createClawHouseTools(api: OpenClawPluginApi): AnyAgentTool[] | null {
  const account = resolveAccountFromConfig(api);
  if (!account) return null;

  const client = new ClawHouseClient(account.botToken, account.apiUrl);

  return [
    {
      name: 'clawhouse_get_next_task',
      description:
        'Pick up the next available task from ClawHouse. Atomically claims the oldest ready_for_bot task and moves it to working_on_it. Returns the task object with instructions, or null if none available.',
      parameters: Type.Object({
        projectId: Type.Optional(
          Type.String({ description: 'Filter to a specific project UUID' }),
        ),
      }),
      async execute(_id, params) {
        const result = await client.getNextTask({
          projectId: params.projectId as string | undefined,
        });
        return textResult(result);
      },
    },
    {
      name: 'clawhouse_list_tasks',
      description:
        'List all tasks in a ClawHouse project, ordered by most recently updated.',
      parameters: Type.Object({
        projectId: Type.String({ description: 'Project UUID (required)' }),
        status: Type.Optional(
          Type.String({
            description:
              'Filter by status: ready_for_bot, working_on_it, waiting_for_human, done',
          }),
        ),
      }),
      async execute(_id, params) {
        const result = await client.listTasks({
          projectId: params.projectId as string,
          status: params.status as string | undefined,
        });
        return textResult(result);
      },
    },
    {
      name: 'clawhouse_comment',
      description:
        'Post a progress update comment on a ClawHouse task. Works on any accessible task regardless of status.',
      parameters: Type.Object({
        taskId: Type.String({ description: 'Task UUID' }),
        content: Type.String({ description: 'Comment text (supports markdown)' }),
      }),
      async execute(_id, params) {
        const result = await client.comment({
          taskId: params.taskId as string,
          content: params.content as string,
        });
        return textResult(result);
      },
    },
    {
      name: 'clawhouse_done',
      description:
        'Mark a working_on_it task as completed. Moves it to waiting_for_human. Always include a deliverable documenting your work in markdown.',
      parameters: Type.Object({
        taskId: Type.String({ description: 'Task UUID' }),
        reason: Type.String({ description: 'Why the task is complete' }),
        deliverable: Type.Optional(
          Type.String({
            description: 'Markdown deliverable documenting what was done and results',
          }),
        ),
      }),
      async execute(_id, params) {
        const result = await client.done({
          taskId: params.taskId as string,
          reason: params.reason as string,
          deliverable: params.deliverable as string | undefined,
        });
        return textResult(result);
      },
    },
    {
      name: 'clawhouse_giveup',
      description:
        'Give up on a working_on_it task. Moves it to waiting_for_human so a human can help. Always include a deliverable with partial progress.',
      parameters: Type.Object({
        taskId: Type.String({ description: 'Task UUID' }),
        reason: Type.String({ description: 'Why the task cannot be completed' }),
        deliverable: Type.Optional(
          Type.String({
            description:
              'Markdown deliverable documenting partial progress and blockers',
          }),
        ),
      }),
      async execute(_id, params) {
        const result = await client.giveup({
          taskId: params.taskId as string,
          reason: params.reason as string,
          deliverable: params.deliverable as string | undefined,
        });
        return textResult(result);
      },
    },
    {
      name: 'clawhouse_list_projects',
      description: 'List all projects accessible to this bot in ClawHouse.',
      parameters: Type.Object({}),
      async execute() {
        const result = await client.listProjects();
        return textResult(result);
      },
    },
    {
      name: 'clawhouse_create_task',
      description:
        'Create a new task in a ClawHouse project. The task starts in ready_for_bot status.',
      parameters: Type.Object({
        projectId: Type.String({ description: 'Project UUID' }),
        title: Type.String({ description: 'Task title (max 200 chars)' }),
        instructions: Type.Optional(
          Type.String({ description: 'Detailed instructions for the task' }),
        ),
      }),
      async execute(_id, params) {
        const result = await client.createTask({
          projectId: params.projectId as string,
          title: params.title as string,
          instructions: params.instructions as string | undefined,
        });
        return textResult(result);
      },
    },
    {
      name: 'clawhouse_create_project',
      description: 'Create a new project in ClawHouse.',
      parameters: Type.Object({
        name: Type.String({ description: 'Project name' }),
        key: Type.String({ description: 'Project key (2-10 uppercase letters)' }),
        description: Type.Optional(Type.String({ description: 'Project description' })),
        color: Type.Optional(
          Type.String({ description: 'Hex color code (e.g. #3B82F6)' }),
        ),
      }),
      async execute(_id, params) {
        const result = await client.createProject({
          name: params.name as string,
          key: params.key as string,
          description: params.description as string | undefined,
          color: params.color as string | undefined,
        });
        return textResult(result);
      },
    },
  ];
}
