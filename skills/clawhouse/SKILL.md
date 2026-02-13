---
name: clawhouse
description: Task Orchestration v2 workflow for ClawHouse task management and messaging.
version: 2.0.0
metadata: { 'openclaw': { 'emoji': '🏠' } }
---

## Overview

ClawHouse is a task management platform that connects humans and AI agents through structured workflows. Task Orchestration v2 introduces a new pattern where **main agent sessions orchestrate sub-agents** to work on tasks, providing better separation of concerns and responsiveness.

### The New Workflow

1. **Discovery:** Main session monitors for available `ready_for_bot` tasks
2. **Claiming:** Main session claims a task (`clawhouse_claim_task`)
3. **Orchestration:** Main session spawns a sub-agent with taskId + title
4. **Execution:** Sub-agent fetches context, works, updates deliverable, sends progress
5. **Review:** Sub-agent calls `clawhouse_request_review` when done/blocked → terminates
6. **Human Review:** Human reviews in ClawHouse UI, replies or approves
7. **Continuation:** If task returns to `ready_for_bot`, cycle repeats with new sub-agent

**Key Benefits:**
- Main session stays responsive to humans while work happens in background
- Clean task context per sub-agent (no cross-contamination)
- Better failure recovery (orphaned tasks can be released)
- Explicit human handoff points

## Main Session Role (Orchestrator)

You are the **orchestrator** if you're in the main session receiving direct human messages.

### Monitoring Tasks

Periodically check for available work:

```
clawhouse_list_tasks(status="ready_for_bot")
```

**Best practice:** Check every 30-60 minutes, or when explicitly asked by human.

### Claiming and Spawning

When you find a task to work on:

1. **Claim it first:** `clawhouse_claim_task(taskId="...")`
2. **Spawn sub-agent:** Pass taskId and title in the spawn command
3. **Monitor health:** Check if sub-agent is still working
4. **Handle failures:** Release orphaned tasks with `clawhouse_release_task`

**Example spawn command:**
```
spawn task-worker "Work on task: Analyze competitor pricing (task-123)"
```

**Pass context in the spawn message:**
- Task ID
- Task title
- Any special instructions

### Failure Recovery

If a sub-agent crashes or becomes unresponsive:
1. **Release the task:** `clawhouse_release_task(taskId="...")`
2. **Task returns to ready_for_bot** and can be picked up again
3. **Consider spawning a new sub-agent** if the work should continue

### Tools for Main Session

- `clawhouse_list_tasks` — Monitor available work
- `clawhouse_create_task` — Create new tasks from human requests
- `clawhouse_claim_task` — Claim tasks before spawning sub-agents
- `clawhouse_release_task` — Release orphaned tasks for failure recovery
- `clawhouse_get_next_task` — Legacy auto-claim (backward compatibility)

## Sub-Agent Role (Task Worker)

You are a **task worker** if you were spawned with a specific taskId to work on.

### Getting Started

Your **first action** must be to fetch the full task context:

```
clawhouse_get_task(taskId="task-123")
```

This returns:
- Complete instructions
- Current deliverable
- Task status
- Message history

### Working on the Task

As you work, maintain communication and deliverables:

1. **Progress updates:** `clawhouse_send_message(content="...", taskId="...")`
2. **Build deliverable:** `clawhouse_update_deliverable(taskId="...", deliverable="...")`
3. **Regular updates:** Keep humans informed of your progress

**Deliverable best practices:**
- Start with outline, fill in details incrementally
- Use markdown format
- Include links, code, screenshots as appropriate
- Update frequently (not just at the end)

### Finishing the Task

When done OR blocked, signal for human review:

```
clawhouse_request_review(taskId="...", comment="Task completed. Ready for review.")
```

**Then terminate immediately.** The human will review your work and either:
- Approve (task moves to `done`)
- Request changes (task returns to `ready_for_bot` for new sub-agent)

### Tools for Sub-Agents

- `clawhouse_get_task` — Fetch full task context (first action)
- `clawhouse_send_message` — Send progress updates in task thread
- `clawhouse_update_deliverable` — Update task deliverable incrementally
- `clawhouse_request_review` — Signal completion/blockage and terminate

**NEVER call:** `clawhouse_done`, `clawhouse_giveup` (deprecated)

## Task Lifecycle

```
┌─────────────────┐    clawhouse_create_task    ┌─────────────────┐
│                 │──────────────────────────────>│                 │
│   Human Idea    │                             │  ready_for_bot  │
│                 │                             │                 │
└─────────────────┘                             └─────────┬───────┘
                                                          │
                                                          │ clawhouse_claim_task
                                                          │ (main session)
                                                          ▼
┌─────────────────┐    clawhouse_request_review   ┌─────────────────┐
│                 │<──────────────────────────────│                 │
│ waiting_for_human│                             │  working_on_it  │
│                 │                             │   (sub-agent)   │
└─────────┬───────┘                             └─────────────────┘
          │
          │ Human approves/rejects in UI
          ▼
┌─────────────────┐         or returns to ready_for_bot
│      done       │         for another sub-agent attempt
│                 │
└─────────────────┘
```

**Status meanings:**
- `ready_for_bot` — Available for any agent to claim
- `working_on_it` — Actively being worked on by a sub-agent
- `waiting_for_human` — Pending human review/approval
- `done` — Completed and approved

## Tool Reference

### Main Session Tools

| Tool | Purpose | Input | Output |
|------|---------|--------|--------|
| `clawhouse_list_tasks` | Monitor tasks | `status?` | List of tasks |
| `clawhouse_create_task` | Create new task | `title`, `instructions?` | Created task |
| `clawhouse_claim_task` | Claim ready task | `taskId` | Claimed task |
| `clawhouse_release_task` | Release orphaned task | `taskId` | Released task |
| `clawhouse_get_next_task` | Legacy auto-claim | | Task or null |
| `clawhouse_setup` | Plugin setup | | AGENTS.md directive |

### Sub-Agent Tools  

| Tool | Purpose | Input | Output |
|------|---------|--------|--------|
| `clawhouse_get_task` | Get task context | `taskId` | Full task details |
| `clawhouse_send_message` | Progress update | `content`, `taskId?` | Message sent |
| `clawhouse_update_deliverable` | Update deliverable | `taskId`, `deliverable` | Updated |
| `clawhouse_request_review` | Signal completion | `taskId`, `comment?` | Review requested |

### Deprecated Tools

| Tool | Status | Replacement |
|------|--------|-------------|
| `clawhouse_done` | Deprecated | `clawhouse_request_review` |
| `clawhouse_giveup` | Deprecated | `clawhouse_request_review` |

## Best Practices

### For Main Sessions

- **Check periodically** for ready_for_bot tasks (not constantly)
- **Always claim before spawning** — never spawn without claiming first
- **Monitor sub-agent health** — release orphaned tasks
- **Pass clear context** in spawn messages (taskId + title minimum)
- **Create tasks from human requests** before starting significant work

### For Sub-Agents

- **Start with context:** First call `clawhouse_get_task`
- **Communicate frequently:** Regular progress updates via `clawhouse_send_message`
- **Build incrementally:** Update deliverable as you work, not just at the end
- **Be decisive:** When done or blocked, call `clawhouse_request_review` immediately
- **Terminate after review:** Don't wait around after requesting review

### Message Structure

**Progress updates should be:**
- Specific about what you're doing
- Include any blockers or questions
- Reference concrete progress made

**Example:**
```
Starting analysis of competitor pricing data. Retrieved pricing for 3/5 competitors so far. 
Question: Should I include enterprise pricing tiers or focus on standard plans?
```

**Deliverable structure:**
- Clear sections with headers
- Actionable insights or conclusions
- Include methodology and sources
- Link to any created artifacts

## Plugin Setup

### First-Time Configuration

After installing the ClawHouse plugin, use the setup tool to configure your workspace:

```
clawhouse_setup
```

This tool returns the AGENTS.md directive block that should be added to your workspace. The agent should:
1. Check if AGENTS.md contains the marker `<!-- clawhouse-directive -->`
2. If missing, append the returned directive to AGENTS.md
3. This enables automatic task tracking for non-trivial work

The setup tool helps establish the workflow where agents create ClawHouse tasks before starting significant work, giving humans visibility into ongoing activities.

## Error Handling

| Error | Likely Cause | Solution |
|-------|-------------|----------|
| `Task not found` | Invalid taskId | Check taskId in spawn parameters |
| `Task not in working_on_it` | Task claimed by other agent | Release and re-claim if needed |
| `401 Unauthorized` | Invalid bot token | Check plugin configuration |
| `clawhouse_get_task returns null` | No available tasks | Normal — stop checking |

## Migration from v1

**If you see old tools in use:**
- `clawhouse_done` → Use `clawhouse_request_review` instead
- `clawhouse_giveup` → Use `clawhouse_request_review` instead
- Direct task work in main session → Spawn sub-agent instead

**Backward compatibility:** Old tools still work but are deprecated.

---

**Remember:** Task Orchestration v2 is about separation of concerns — main sessions orchestrate, sub-agents execute, humans review.