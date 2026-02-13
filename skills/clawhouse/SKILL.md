---
name: clawhouse
description: Workflow knowledge for ClawHouse task management and messaging.
version: 2.0.0
metadata: { 'openclaw': { 'emoji': '🏠' } }
---

## Installation

After installing the ClawHouse plugin, run `clawhouse_setup` to configure your workspace. This adds the self-tasking directive to your AGENTS.md so you'll always create tasks before starting work.

## Messaging

You are connected to ClawHouse via a 1:1 messaging channel. When a human sends you a message, **just reply naturally** — the channel handles routing automatically. You do not need to use any tool to send or receive messages.

- **Inbound:** Human messages appear as regular conversation messages
- **Outbound:** Your replies are automatically delivered back to the human
- **Threading:** Messages may be linked to a task (visible as thread context)

No special syntax, no user IDs, no targeting required. Just respond to the conversation.

## Task Workflow

Tasks follow a strict state machine. Understand this before using any tool.

```
ready_for_bot ──[claim]──> working_on_it ──[request_review]──> waiting_for_human ──[approve]──> done
       ▲              │                              │
       │        [release]                      [decline]
       └──────────────┘                              │
       └─────────────────────────────────────────────┘
```

### Statuses

| Status | Meaning |
|---|---|
| `ready_for_bot` | Available for a bot to claim |
| `working_on_it` | A bot is actively working on this task |
| `waiting_for_human` | Bot submitted for human review |
| `done` | Human approved the deliverable |

### Tools

| Tool | Description |
|---|---|
| `clawhouse_create_task` | Create a new task (starts as `ready_for_bot`) |
| `clawhouse_list_tasks` | List tasks, optionally filtered by status |
| `clawhouse_get_task` | Fetch full task context by ID (instructions, deliverable, messages) |
| `clawhouse_claim_task` | Claim a specific `ready_for_bot` task → `working_on_it` |
| `clawhouse_release_task` | Release a task back to `ready_for_bot` (failure recovery) |
| `clawhouse_update_deliverable` | Update the task's deliverable markdown incrementally |
| `clawhouse_request_review` | Signal human to review → `waiting_for_human`. Bot should stop after this. |
| `clawhouse_send_message` | Send a message in the task thread (progress updates, questions) |
| `clawhouse_setup` | One-time setup: returns AGENTS.md directive block |

### Self-Tasking

**When you start any non-trivial work, create a task first.** This applies whether a human asked you to do something or you're working proactively. The only exceptions are quick one-liners that take seconds.

**Why:** Tasks give your human visibility into what you're doing, create a paper trail of deliverables, and let you collaborate through comments. Work without a task is invisible work.

**Flow:**
1. **Create:** `clawhouse_create_task` with a clear title and instructions
2. **Claim:** `clawhouse_claim_task` with the task ID to move it to `working_on_it`
3. **Work:** Do the work. Use `clawhouse_update_deliverable` to build up deliverable incrementally. Use `clawhouse_send_message` for progress updates.
4. **Review:** `clawhouse_request_review` when done. The human will approve or decline.

**Sub-agent pattern (recommended for longer tasks):**
1. Main session creates + claims the task
2. Spawn a sub-agent with the task ID
3. Sub-agent calls `clawhouse_get_task` to load full context
4. Sub-agent works, updates deliverable, then calls `clawhouse_request_review`
5. One task per sub-agent to keep context clean

**Task titles:** Keep them short and scannable. Good: "Research competitor HumanLayer". Bad: "Do some research on a competitor called HumanLayer and write up findings".

## Decision Tree

When checking for work:
1. Call `clawhouse_list_tasks` with `status: "ready_for_bot"` to see available tasks
2. **Got tasks?** Pick one, `clawhouse_claim_task`, then work on it
3. **Empty list?** No tasks available — stop checking
4. **Can't complete?** Call `clawhouse_release_task` to put it back, or `clawhouse_request_review` with a comment explaining the blocker

When given work by a human (chat, Slack, etc.):
1. Create a task via `clawhouse_create_task`
2. Claim it via `clawhouse_claim_task`
3. Work on it, build deliverable, then `clawhouse_request_review`

## Human Review Outcomes

- **Approve:** Task moves to `done`. Work is accepted.
- **Decline:** Task moves back to `ready_for_bot` with the human's feedback. Bot can claim and retry with the feedback incorporated.

## Rules

1. **Self-task by default:** Create a ClawHouse task before starting non-trivial work
2. **Status gates:** You can only `request_review` or `release` tasks in `working_on_it` status
3. **No manual status changes:** All state transitions happen through the tools above
4. **Deliverables in markdown:** Build up the deliverable incrementally using `update_deliverable`
5. **Request review, don't just finish:** Always end with `clawhouse_request_review` so the human can approve
6. **Release early:** If you can't complete a task, `clawhouse_release_task` to free it — don't spin
7. **One task per sub-agent:** Spawn a dedicated sub-agent for each task to keep context clean
8. **No assignment required:** Any bot can claim any `ready_for_bot` task

## Error Handling

| Error | Meaning | Action |
|---|---|---|
| `clawhouse_list_tasks` returns empty | No tasks available | Stop checking — do not retry in a loop |
| 404 on `clawhouse_claim_task` | Task not in `ready_for_bot` or doesn't exist | Another bot may have claimed it. Try a different task. |
| 404 on `clawhouse_request_review` | Task not in `working_on_it` status | Check if task was already reviewed or released |
| 404 on `clawhouse_release_task` | Task not in `working_on_it` status | Task may have been released already |
| 401 Unauthorized | Bot token invalid | Check channel configuration |
