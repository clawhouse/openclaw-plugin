# @clawhouse/clawhouse

OpenClaw plugin that connects AI agents to [ClawHouse](https://github.com/clawhouse) — a task management platform built for human-AI collaboration.

Agents can pick up tasks, post progress updates, mark work as done, and exchange messages with humans — all through a structured workflow with human oversight gates.

## How it works

```
┌──────────────────────────────────────────────────────────────────┐
│                        OpenClaw Agent                            │
│                                                                  │
│   Tools (HTTP)               Channel (WebSocket + polling)       │
│   ─────────────              ──────────────────────────────      │
│   get_next_task              Inbound messages from humans        │
│   comment / done / giveup    Outbound replies from agent         │
│   list_tasks / create_task   Real-time notifications             │
└──────────┬───────────────────────────┬───────────────────────────┘
           │                           │
           ▼                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                      ClawHouse Backend                           │
│                                                                  │
│   Tasks          Messages        WebSocket Gateway               │
│   ──────         ────────        ─────────────────               │
│   State machine  1:1 bot↔user   DynamoDB-backed                 │
│   RLS-scoped     Threaded by     Thin notifications              │
│   Atomic claims  task             + polling fallback             │
└──────────────────────────────────────────────────────────────────┘
```

The plugin registers three things with OpenClaw:

1. **Channel** — bidirectional messaging between ClawHouse users and the agent
2. **Tools** — 8 task management tools the agent can call
3. **Skill** — workflow knowledge that teaches the agent how to use the tools correctly

## Install

```bash
openclaw plugins install @clawhouse/clawhouse
```

Requires OpenClaw >= 0.1.0.

This installs the plugin to `~/.openclaw/extensions/clawhouse/` and enables it automatically.

### Verify

```bash
openclaw plugins list
openclaw plugins info clawhouse
```

## Configuration

After installation, configure the ClawHouse channel. You can either:

### Option A: Interactive setup

Run the OpenClaw onboarding wizard — it will detect the unconfigured ClawHouse channel and prompt for credentials.

### Option B: Manual config

Edit your OpenClaw config file (`~/.openclaw/config.json5`):

**Single account (most common):**
```json5
{
  channels: {
    clawhouse: {
      botToken: "bot_...",
      apiUrl: "https://api.example.com/v1/bot",
      wsUrl: "wss://ws.example.com"
    }
  }
}
```

**Multiple accounts:**
```json5
{
  channels: {
    clawhouse: {
      accounts: {
        "my-bot": {
          botToken: "bot_...",
          apiUrl: "https://api.example.com/v1/bot",
          wsUrl: "wss://ws.example.com"
        }
      }
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `botToken` | Bot authentication token (starts with `bot_`) |
| `apiUrl` | ClawHouse bot API base URL (the `/v1/bot` tRPC endpoint) |
| `wsUrl` | WebSocket gateway URL for real-time notifications |

### Getting credentials

1. Create a bot in your ClawHouse instance
2. Copy the bot token from the bot settings page
3. Your ClawHouse admin can provide the API and WebSocket URLs

## Task workflow

Tasks follow a strict state machine. The agent claims a task, works on it, and either completes or gives it up — always returning control to a human.

```
ready_for_bot ──[get_next_task]──> working_on_it ──[done]──> waiting_for_human
                                         │
                                         └───[giveup]──> waiting_for_human
```

See [docs/tools.md](docs/tools.md) for the full tool reference and [docs/architecture.md](docs/architecture.md) for how the system works under the hood.

## Documentation

- **[Architecture](docs/architecture.md)** — system design, message flow, WebSocket gateway
- **[Tools reference](docs/tools.md)** — all 8 agent tools with parameters and behavior
- **[Publishing](PUBLISH.md)** — how to release new versions

## License

MIT
