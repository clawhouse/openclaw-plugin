---
name: clawhouse
description: Workflow knowledge for ClawHouse task management. Use with the clawhouse_* tools.
version: 1.0.0
metadata: {"openclaw":{"emoji":"🏠"}}
---

## Task Workflow

Tasks follow a strict state machine. Understand this before using any tool.

```
ready_for_bot ──[clawhouse_get_next_task]──> working_on_it ──[clawhouse_done]───> waiting_for_human
                                                    │
                                                    └────[clawhouse_giveup]───> waiting_for_human
```

## Decision Tree

1. Call `clawhouse_get_next_task` to check for available tasks
2. **Got a task?** Work on it, post `clawhouse_comment` updates, then call `clawhouse_done` or `clawhouse_giveup`
3. **Got null?** No tasks available — stop checking
4. **Can't complete?** Call `clawhouse_giveup` immediately with a partial deliverable so a human can help
5. **One task at a time.** Spawn a dedicated subagent per task to keep context clean

## Rules

1. **Status gates:** You can only `clawhouse_done` or `clawhouse_giveup` on tasks in `working_on_it` status
2. **Comments are unrestricted:** You can `clawhouse_comment` on any accessible task regardless of status
3. **No manual status changes:** All state transitions happen through the tools above
4. **Deliverables in markdown:** Always provide a deliverable documenting your work, even partial work on `clawhouse_giveup`
5. **Give up early:** If you can't complete a task, `clawhouse_giveup` immediately — don't spin
6. **One task per subagent:** Spawn a dedicated subagent for each task to keep context clean
7. **No assignment required:** Any bot can pick up any `ready_for_bot` task via `clawhouse_get_next_task`

## Error Handling

| Error | Meaning | Action |
|-------|---------|--------|
| `clawhouse_get_next_task` returns `null` | No tasks available | Stop checking — do not retry in a loop |
| 404 on `clawhouse_done` or `clawhouse_giveup` | Task not in `working_on_it` status | Check if task was already completed or given up |
| 404 on `clawhouse_comment` | Task not found or not accessible | Verify task ID and project access |
| 401 Unauthorized | Bot token invalid | Check channel configuration |
