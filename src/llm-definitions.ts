/**
 * LLM-Facing Definitions — single source of truth.
 *
 * Every string an LLM sees (tool names, descriptions, parameter descriptions,
 * channel metadata, hints, status messages) lives here.
 *
 * Also see: skills/clawhouse/SKILL.md (must stay there for plugin system)
 */
import { Type } from '@sinclair/typebox';

// ─── Tools ────────────────────────────────────────────────────
// Each tool = { name, description, parameters (TypeBox schema) }
// tools.ts spreads these and adds only the execute handler.

export const TOOLS = {
  GET_NEXT_TASK: {
    name: 'clawhouse_get_next_task',
    description:
      'Pick up the next available task from ClawHouse. Atomically claims the oldest ready_for_bot task and moves it to working_on_it. Returns the task object with instructions, or null if none available.',
    parameters: Type.Object({
      projectId: Type.Optional(
        Type.String({ description: 'Filter to a specific project UUID' }),
      ),
    }),
  },
  LIST_TASKS: {
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
  },
  DONE: {
    name: 'clawhouse_done',
    description:
      'Mark a working_on_it task as completed. Moves it to waiting_for_human. Always include a deliverable documenting your work in markdown.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'Task UUID' }),
      reason: Type.String({ description: 'Why the task is complete' }),
      deliverable: Type.String({
        description:
          'Markdown deliverable documenting what was done and results',
      }),
    }),
  },
  GIVEUP: {
    name: 'clawhouse_giveup',
    description:
      'Give up on a working_on_it task. Moves it to waiting_for_human so a human can help. Always include a deliverable with partial progress.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'Task UUID' }),
      reason: Type.String({
        description: 'Why the task cannot be completed',
      }),
      deliverable: Type.String({
        description:
          'Markdown deliverable documenting partial progress and blockers',
      }),
    }),
  },
  LIST_PROJECTS: {
    name: 'clawhouse_list_projects',
    description: 'List all projects accessible to this bot in ClawHouse.',
    parameters: Type.Object({}),
  },
  CREATE_TASK: {
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
  },
  SETUP: {
    name: 'clawhouse_setup',
    description:
      'Run after installing ClawHouse plugin. Returns the AGENTS.md directive block for self-tasking. The agent should check if AGENTS.md contains this block and add it if missing.',
    parameters: Type.Object({}),
  },
  CREATE_PROJECT: {
    name: 'clawhouse_create_project',
    description: 'Create a new project in ClawHouse.',
    parameters: Type.Object({
      name: Type.String({ description: 'Project name' }),
      key: Type.String({
        description: 'Project key (2-10 uppercase letters)',
      }),
      description: Type.Optional(
        Type.String({ description: 'Project description' }),
      ),
      color: Type.Optional(
        Type.String({ description: 'Hex color code (e.g. #3B82F6)' }),
      ),
    }),
  },
} as const;

// ─── Channel ──────────────────────────────────────────────────

export const CHANNEL_META = {
  name: 'ClawHouse',
  description: '1:1 messaging channel for ClawHouse bots',
} as const;

export const CHANNEL_HINTS = {
  targetResolver: 'Use a ClawHouse ID (e.g. U9QF3C6X1A)',
  onboardingSelection:
    'Connect to a ClawHouse instance for 1:1 bot messaging',
} as const;

export const STATUS_MESSAGES = {
  probeNotConfigured: 'Account not configured',
  notConfigured: {
    message: 'Account is not configured',
    fix: 'Run onboarding to set bot token and API URL',
  },
  disabled: {
    message: 'Account is disabled',
    fix: 'Set enabled: true in config',
  },
  notRunning: {
    message: 'Gateway is not running',
  },
  probeFailed: {
    fix: 'Check bot token and API URL',
  },
} as const;
