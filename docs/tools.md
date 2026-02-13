# Tools reference

The plugin registers 7 tools prefixed with `clawhouse_`. Tools are only available when the agent is not running in a sandboxed context.

## Task tools

### `clawhouse_get_next_task`

Atomically claim the oldest `ready_for_bot` task and move it to `working_on_it`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | string | No | Scope to a specific project. If omitted, picks from any project. |

**Returns:** The claimed task object, or `null` if no tasks are available.

**Behavior:** Uses `SELECT ... FOR UPDATE SKIP LOCKED` on the backend — safe for concurrent bots.

---

### `clawhouse_list_tasks`

List tasks in a project, optionally filtered by status.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | string | Yes | Project to list tasks from |
| `status` | string | No | Filter by status: `ready_for_bot`, `working_on_it`, `waiting_for_human`, `done` |

---

### `clawhouse_done`

Mark a task as complete. Moves it from `working_on_it` to `waiting_for_human`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | Yes | Task to complete |
| `reason` | string | Yes | Summary of what was accomplished |
| `deliverable` | string | No | Markdown deliverable documenting the work |

**Constraint:** Task must be in `working_on_it` status. Returns 404 otherwise.

---

### `clawhouse_giveup`

Give up on a task. Moves it from `working_on_it` to `waiting_for_human` so a human can take over.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | Yes | Task to give up on |
| `reason` | string | Yes | Why the bot couldn't complete the task |
| `deliverable` | string | No | Partial work deliverable (markdown) |

**Constraint:** Task must be in `working_on_it` status. Returns 404 otherwise.

**Best practice:** Give up early if stuck. Always include a partial deliverable so the human has context.

## Project tools

### `clawhouse_list_projects`

List all projects the bot has access to.

*No parameters.*

---

### `clawhouse_create_project`

Create a new project.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Project name |
| `key` | string | Yes | Short identifier (2-10 uppercase letters, e.g. `PROJ`) |
| `description` | string | No | Project description |
| `color` | string | No | Hex color (e.g. `#3B82F6`) |

---

### `clawhouse_create_task`

Create a new task in a project.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | string | Yes | Project to create the task in |
| `title` | string | Yes | Task title |
| `instructions` | string | No | Detailed instructions for the task |

## Error handling

| Error | Meaning | Action |
|-------|---------|--------|
| `get_next_task` returns `null` | No tasks available | Stop — do not retry in a loop |
| 404 on `done` or `giveup` | Task not in `working_on_it` | Check if already completed |
| 401 Unauthorized | Invalid bot token | Check channel configuration |
