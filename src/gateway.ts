import WebSocket from 'ws';

import { ClawHouseClient } from './client';
import { deliverMessageToAgent } from './deliver';
import { getClawHouseRuntime } from './runtime';
import type {
  ChannelGatewayContext,
  ChatMessage,
  PluginLogger,
  WsNotification,
} from './types';

const PING_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes (API GW idle timeout = 10 min)
const POLL_FALLBACK_INTERVAL_MS = 30 * 1000; // 30s fallback when WS is down
const BACKOFF_INITIAL_MS = 2000;
const BACKOFF_MAX_MS = 30000;
const BACKOFF_FACTOR = 1.8;

interface BackoffState {
  attempt: number;
}

function nextBackoff(state: BackoffState): number {
  const delay = Math.min(
    BACKOFF_INITIAL_MS * Math.pow(BACKOFF_FACTOR, state.attempt),
    BACKOFF_MAX_MS,
  );
  const jitter = delay * 0.25 * Math.random();
  state.attempt++;
  return delay + jitter;
}

function resetBackoff(state: BackoffState): void {
  state.attempt = 0;
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Persistent cursor management.
 * Stores cursor on disk so we can resume from the right position after restart.
 */
function loadCursor(ctx: ChannelGatewayContext): string | null {
  try {
    const runtime = getClawHouseRuntime();
    const fs = require('fs') as typeof import('fs');
    const path = runtime.state.resolveStorePath(
      `clawhouse/${ctx.accountId}/cursor`,
    );
    return fs.readFileSync(path, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

function saveCursor(ctx: ChannelGatewayContext, cursor: string): void {
  try {
    const runtime = getClawHouseRuntime();
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const filePath = runtime.state.resolveStorePath(
      `clawhouse/${ctx.accountId}/cursor`,
    );
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, cursor, 'utf-8');
  } catch {
    // Non-fatal — we'll just re-process some messages on restart
  }
}

/**
 * Main entry point for the ClawHouse channel gateway.
 * Called by OpenClaw's channel manager via gateway.startAccount().
 *
 * Maintains a WebSocket connection for real-time notifications
 * and polls the messages endpoint for actual data.
 * Falls back to interval-based polling if WebSocket is unavailable.
 */
export async function startClawHouseConnection(
  ctx: ChannelGatewayContext,
): Promise<void> {
  const account = ctx.account;
  const client = new ClawHouseClient(account.botToken, account.apiUrl);
  const log = ctx.log ?? getClawHouseRuntime().logging.createLogger('clawhouse');

  let cursor = loadCursor(ctx);
  const backoff: BackoffState = { attempt: 0 };

  log.info(
    `Starting ClawHouse connection for account ${ctx.accountId}` +
      (cursor ? ` (resuming from cursor ${cursor})` : ' (fresh start)'),
  );

  // Outer reconnection loop — runs until OpenClaw shuts down
  while (!ctx.abortSignal.aborted) {
    try {
      const { ticket, wsUrl } = await client.getWsTicket();
      resetBackoff(backoff);

      log.info(`Got WS ticket, connecting to ${wsUrl}...`);

      cursor = await runWebSocketConnection({
        ticket,
        wsUrl,
        client,
        ctx,
        cursor,
        log,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // If ticket fetch fails, fall back to polling
      if (message.includes('API error')) {
        log.warn(`Ticket fetch failed: ${message}. Falling back to polling.`);
        cursor = await runPollingFallback({ client, ctx, cursor, log });
      } else {
        log.warn(`Connection error: ${message}`);
      }

      if (ctx.abortSignal.aborted) break;

      const delay = nextBackoff(backoff);
      log.info(`Reconnecting in ${Math.round(delay)}ms...`);
      await sleepWithAbort(delay, ctx.abortSignal);
    }
  }

  log.info('ClawHouse connection loop exited.');
}

/**
 * Runs a single WebSocket connection session.
 * Returns the latest cursor when the connection closes.
 */
async function runWebSocketConnection(opts: {
  ticket: string;
  wsUrl: string;
  client: ClawHouseClient;
  ctx: ChannelGatewayContext;
  cursor: string | null;
  log: PluginLogger;
}): Promise<string | null> {
  const { ticket, wsUrl, client, ctx, log } = opts;
  let cursor = opts.cursor;

  return new Promise<string | null>((resolve, reject) => {
    const ws = new WebSocket(`${wsUrl}?ticket=${ticket}`);
    let pingInterval: ReturnType<typeof setInterval> | undefined;

    ws.on('open', () => {
      ctx.setStatus({ running: true, lastStartAt: Date.now() });
      log.info('WebSocket connected.');

      // Keepalive ping every 5 minutes
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'ping' }));
        }
      }, PING_INTERVAL_MS);

      // Initial catch-up poll
      pollAndDeliver(client, ctx, cursor, log).then((newCursor) => {
        if (newCursor) cursor = newCursor;
      });
    });

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString()) as WsNotification | { action: string };

        if (msg.action === 'notify') {
          // Thin notification — poll for full data
          const newCursor = await pollAndDeliver(client, ctx, cursor, log);
          if (newCursor) cursor = newCursor;
        }
        // Ignore pong and other messages
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`Error processing WS message: ${message}`);
      }
    });

    ws.on('close', (code, reason) => {
      clearInterval(pingInterval);
      ctx.setStatus({ running: false, lastStopAt: Date.now() });
      log.info(`WebSocket closed: ${code} ${reason.toString()}`);
      resolve(cursor);
    });

    ws.on('error', (err) => {
      clearInterval(pingInterval);
      ctx.setStatus({ running: false, lastError: err.message });
      reject(err);
    });

    // Clean shutdown
    ctx.abortSignal.addEventListener(
      'abort',
      () => {
        clearInterval(pingInterval);
        ws.close(1000, 'shutdown');
      },
      { once: true },
    );
  });
}

/**
 * Fallback polling loop when WebSocket is unavailable.
 * Polls every 30s until aborted or until we should retry WebSocket.
 */
async function runPollingFallback(opts: {
  client: ClawHouseClient;
  ctx: ChannelGatewayContext;
  cursor: string | null;
  log: PluginLogger;
}): Promise<string | null> {
  const { client, ctx, log } = opts;
  let cursor = opts.cursor;
  let iterations = 0;
  const maxIterations = 10; // After 10 polls (~5 min), try WebSocket again

  ctx.setStatus({ running: true, lastStartAt: Date.now() });
  log.info('Running in polling fallback mode.');

  while (!ctx.abortSignal.aborted && iterations < maxIterations) {
    const newCursor = await pollAndDeliver(client, ctx, cursor, log);
    if (newCursor) cursor = newCursor;
    iterations++;
    await sleepWithAbort(POLL_FALLBACK_INTERVAL_MS, ctx.abortSignal);
  }

  ctx.setStatus({ running: false, lastStopAt: Date.now() });
  return cursor;
}

/**
 * Poll the messages endpoint and deliver new messages to the OpenClaw agent.
 * Returns the new cursor, or null if no messages.
 */
async function pollAndDeliver(
  client: ClawHouseClient,
  ctx: ChannelGatewayContext,
  cursor: string | null,
  log: PluginLogger,
): Promise<string | null> {
  try {
    const response = await client.listMessages({
      cursor,
    });

    if (response.items.length === 0) return null;

    log.info(`Received ${response.items.length} new message(s).`);

    for (const message of response.items) {
      await deliverMessageToAgent(ctx, message);
    }

    // Persist cursor
    if (response.cursor) {
      saveCursor(ctx, response.cursor);
    }

    return response.cursor;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Poll failed: ${message}`);
    return null;
  }
}
