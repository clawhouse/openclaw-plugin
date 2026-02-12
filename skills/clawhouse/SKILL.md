---
name: clawhouse
description: Workflow knowledge for ClawHouse task management and messaging.
version: 1.2.0
metadata: { 'openclaw': { 'emoji': '🏠' } }
---

## Messaging

You are connected to ClawHouse via a 1:1 messaging channel. When a human sends you a message, **just reply naturally** — the channel handles routing automatically. You do not need to use any tool to send or receive messages.

- **Inbound:** Human messages appear as regular conversation messages
- **Outbound:** Your replies are automatically delivered back to the human
- **Threading:** Messages may be linked to a task (visible as thread context)

No special syntax, no user IDs, no targeting required. Just respond to the conversation.

## Task Workflow

Tasks follow a strict state machine. Understand this before using any tool.

```
ready_for_bot ──[clawhouse_get_next_task]──> working_on_it ──[clawhouse_done]───> waiting_for_human
                                                    │
                                                    └────[clawhouse_giveup]───> waiting_for_human
```

### Self-Tasking

**When you start any non-trivial work, create a task first.** This applies whether a human asked you to do something or you're working proactively. The only exceptions are quick one-liners that take seconds (simple lookups, short answers, config changes).

**Why:** Tasks give your human visibility into what you're doing, create a paper trail of deliverables, and let you collaborate through comments. Work without a task is invisible work.

**Flow:**
1. **Create:** `clawhouse_create_task` with a clear title and instructions describing what you'll do
2. **Claim:** `clawhouse_get_next_task` (optionally filtered by projectId) to move it to `working_on_it`
3. **Work:** Do the work. Post `clawhouse_comment` updates for meaningful progress
4. **Deliver:** `clawhouse_done` with a markdown deliverable, or `clawhouse_giveup` if blocked

**Choosing a project:** Use `clawhouse_list_projects` to find the right project. If no project fits, create the task in whichever project is closest — the human can move it.

**Task titles:** Keep them short and scannable. Good: "Research competitor HumanLayer". Bad: "Do some research on a competitor called HumanLayer and write up findings".

## Decision Tree

When checking for work:
1. Call `clawhouse_get_next_task` to check for available tasks
2. **Got a task?** Work on it, post `clawhouse_comment` updates, then call `clawhouse_done` or `clawhouse_giveup`
3. **Got null?** No tasks available — stop checking
4. **Can't complete?** Call `clawhouse_giveup` immediately with a partial deliverable so a human can help

When given work by a human (chat, Slack, etc.):
1. Create a task via `clawhouse_create_task`
2. Claim it via `clawhouse_get_next_task`
3. Work on it, deliver via `clawhouse_done` or `clawhouse_giveup`

## Rules

1. **Self-task by default:** Create a Clawhouse task before starting non-trivial work
2. **Status gates:** You can only `clawhouse_done` or `clawhouse_giveup` on tasks in `working_on_it` status
3. **Comments are unrestricted:** You can `clawhouse_comment` on any accessible task regardless of status
4. **No manual status changes:** All state transitions happen through the tools above
5. **Deliverables in markdown:** Always provide a deliverable documenting your work, even partial work on `clawhouse_giveup`
6. **Give up early:** If you can't complete a task, `clawhouse_giveup` immediately — don't spin
7. **One task per subagent:** Spawn a dedicated subagent for each task to keep context clean
8. **No assignment required:** Any bot can pick up any `ready_for_bot` task via `clawhouse_get_next_task`

## Error Handling

| Error                                         | Meaning                            | Action                                          |
| --------------------------------------------- | ---------------------------------- | ----------------------------------------------- |
| `clawhouse_get_next_task` returns `null`      | No tasks available                 | Stop checking — do not retry in a loop          |
| 404 on `clawhouse_done` or `clawhouse_giveup` | Task not in `working_on_it` status | Check if task was already completed or given up |
| 404 on `clawhouse_comment`                    | Task not found or not accessible   | Verify task ID and project access               |
| 401 Unauthorized                              | Bot token invalid                  | Check channel configuration                     |
