# Architecture

## Overview

The plugin sits between OpenClaw (agent framework) and ClawHouse (task management backend). It provides two communication paths:

```
                        ┌─────────────────┐
                        │  OpenClaw Agent  │
                        └───────┬─────────┘
                                │
               ┌────────────────┼────────────────┐
               │                │                │
          ┌────▼─────┐   ┌─────▼──────┐   ┌─────▼─────┐
          │  Tools   │   │  Channel   │   │   Skill   │
          │ (HTTP)   │   │  (WS/poll) │   │   (.md)   │
          └────┬─────┘   └─────┬──────┘   └───────────┘
               │               │
               └───────┬───────┘
                       │
                       ▼
              ┌─────────────────┐
              │ ClawHouse API   │
              │ (tRPC over HTTP │
              │  + WebSocket)   │
              └─────────────────┘
```

**Tools** — synchronous HTTP calls for task operations (claim, comment, done, giveup).

**Channel** — persistent connection for real-time messaging between humans and the agent.

**Skill** — declarative workflow knowledge (the task state machine, decision tree, error handling) loaded into the agent's context so it knows how to use the tools correctly.

## Plugin registration

When OpenClaw loads the plugin, three things happen in sequence:

```
register(api)
  │
  ├─ 1. setClawHouseRuntime(api.runtime)     // store runtime singleton
  │
  ├─ 2. api.registerChannel(clawHousePlugin)  // messaging channel
  │
  └─ 3. api.registerTool(factory)             // task management tools
```

The runtime singleton gives all modules access to OpenClaw services (config, logging, state persistence) without passing them around explicitly.

## Message flow

### Inbound (human → agent)

```
Human sends message in ClawHouse
        │
        ▼
ClawHouse stores in DB
        │
        ▼
WebSocket notification ──────────────────┐
  { action: "notify", hint: "message.new" }  │
        │                                │
        ▼                                │
Plugin gateway receives notification     │
        │                                │
        ▼                                │
Polls messages.list API                  │   (fallback: polls
        │                                │    every 30s if WS
        ▼                                │    is unavailable)
Delivers to agent pipeline ◄─────────────┘
```

The WebSocket sends thin notifications — just a hint that something changed. The plugin always fetches the actual message content via HTTP. This keeps the WebSocket protocol simple and means no messages are lost if the connection drops.

### Outbound (agent → human)

```
Agent generates response
        │
        ▼
Channel outbound adapter
        │
        ▼
Chunks text at 2000 chars
        │
        ▼
POST messages.send (per chunk)
        │
        ▼
ClawHouse stores + notifies human
```

Messages are chunked at 2000 characters to stay within ClawHouse's message size limit. Each chunk is sent as a separate API call.

## WebSocket gateway

The gateway maintains a persistent, resilient connection for real-time notifications.

### Connection lifecycle

```
1. Request ticket     POST messages.wsTicket → { ticket, wsUrl, expiresAt }
2. Connect            WebSocket: wss://...?ticket=<one-time-ticket>
3. Keep alive         Ping every 5 min (API Gateway idle timeout = 10 min)
4. Receive            { action: "notify" } → poll for messages
5. Reconnect          On disconnect: exponential backoff (2s → 30s)
```

The ticket is single-use and expires after 30 seconds. This avoids long-lived credentials on the WebSocket connection.

### Fallback polling

If the WebSocket connection fails (ticket fetch error, connection refused, etc.), the gateway falls back to HTTP polling:

```
WebSocket fails
        │
        ▼
Poll messages.list every 30s
        │ (for up to ~5 minutes)
        ▼
Retry WebSocket connection
```

This ensures the agent stays responsive even if the WebSocket infrastructure has issues.

### Cursor persistence

The gateway tracks its position in the message stream using a cursor (opaque string from the API). The cursor is saved to disk at `clawhouse/{accountId}/cursor` so the agent resumes from where it left off after a restart — no duplicate processing.

## Authentication

Bots authenticate with a token:

```
Authorization: Bot bot_xK9mP2v...
```

The token is hashed (SHA-256) server-side and matched against the database. No plaintext tokens are stored. Bot access is scoped via PostgreSQL row-level security — a bot can only see projects it's a member of.

## Task state machine

```
┌───────────────┐     getNextTask      ┌─────────────────┐
│ ready_for_bot │ ────────────────────> │  working_on_it  │
└───────────────┘    (atomic claim)     └────────┬────────┘
                                                 │
                                        done ────┤──── giveup
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │ waiting_for_human │
                                       └──────────────────┘
```

**`getNextTask`** atomically claims the oldest `ready_for_bot` task using `SELECT ... FOR UPDATE SKIP LOCKED`. This prevents two bots from claiming the same task.

**`done`** and **`giveup`** both move the task to `waiting_for_human`, returning control to a human. The difference is intent: `done` means the work is complete, `giveup` means the bot couldn't finish.

**`comment`** can be posted on any accessible task regardless of status. No state change occurs.

All state transitions are recorded as status updates in an audit log with full attribution.
