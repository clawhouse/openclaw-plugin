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
      'Pick up the next available task from ClawHouse. Atomically claims the oldest ready_for_bot task and moves it to working_on_it. Returns the task object with instructions, or null if none available. DEPRECATED: Use clawhouse_claim_task instead for Task Orchestration v2.',
    parameters: Type.Object({}),
  },
  GET_TASK: {
    name: 'clawhouse_get_task',
    description:
      'Fetch task by ID. Returns complete task context including instructions, deliverable, status, and message history. This is typically the first action a sub-agent takes to get full task context.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'Task UUID to fetch' }),
    }),
  },
  CLAIM_TASK: {
    name: 'clawhouse_claim_task',
    description:
      'Claim a ready_for_bot task and move it to working_on_it status. Used by main session before spawning a sub-agent.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'Task UUID to claim' }),
    }),
  },
  RELEASE_TASK: {
    name: 'clawhouse_release_task',
    description:
      'Release a task back to ready_for_bot status. Used for failure recovery when a sub-agent crashes or needs to give up.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'Task UUID to release' }),
    }),
  },
  SEND_MESSAGE: {
    name: 'clawhouse_send_message',
    description:
      'Send a message in the task thread (status update, question, progress report, etc). Maps to the existing messages.send API.',
    parameters: Type.Object({
      content: Type.String({ description: 'Message content' }),
      taskId: Type.Optional(Type.String({ description: 'Task UUID (optional if context provides it)' })),
    }),
  },
  UPDATE_DELIVERABLE: {
    name: 'clawhouse_update_deliverable',
    description:
      'Update the task\'s deliverable markdown. Sub-agents should build up deliverables incrementally as they work.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'Task UUID' }),
      deliverable: Type.String({ description: 'Markdown deliverable content' }),
    }),
  },
  REQUEST_REVIEW: {
    name: 'clawhouse_request_review',
    description:
      'Signal the human to review this task. Moves task to waiting_for_human status. Sub-agent should terminate after calling this. Replaces clawhouse_done and clawhouse_giveup.',
    parameters: Type.Object({
      taskId: Type.String({ description: 'Task UUID' }),
      comment: Type.Optional(Type.String({ description: 'Optional comment for the human reviewer' })),
    }),
  },
  LIST_TASKS: {
    name: 'clawhouse_list_tasks',
    description:
      'List all tasks in ClawHouse, ordered by most recently updated.',
    parameters: Type.Object({
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
      'DEPRECATED: Use clawhouse_request_review instead. Mark a working_on_it task as completed. Moves it to waiting_for_human. Always include a deliverable documenting your work in markdown.',
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
      'DEPRECATED: Use clawhouse_request_review instead. Give up on a working_on_it task. Moves it to waiting_for_human so a human can help. Always include a deliverable with partial progress.',
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
  CREATE_TASK: {
    name: 'clawhouse_create_task',
    description:
      'Create a new task in ClawHouse. The task starts in ready_for_bot status.',
    parameters: Type.Object({
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
