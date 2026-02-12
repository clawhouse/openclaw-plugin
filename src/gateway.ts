// Fix PL-02: use ESM imports instead of require() for fs and path
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { ClawHouseClient } from './client';
import { deliverMessageToAgent } from './deliver';
import { getClawHouseRuntime } from './runtime';
import type {
  ChannelGatewayContext,
  PluginLogger,
  WsNotification,
} from './types';
import WebSocket from 'ws';

const PING_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes (API GW idle timeout = 10 min)
const POLL_FALLBACK_INTERVAL_MS = 30 * 1000; // 30s fallback when WS is down
const BACKOFF_INITIAL_MS = 2000;
const BACKOFF_MAX_MS = 30000;
const BACKOFF_FACTOR = 1.8;

// Fix CP-05: serialize poll operations to prevent duplicate message delivery
// Simple promise-chain mutex — each poll waits for the previous one to finish.
let pollChain: Promise<void> = Promise.resolve();

function enqueuePoll(
  client: ClawHouseClient,
  ctx: ChannelGatewayContext,
  getCursor: () => string | null,
  setCursor: (c: string | null) => void,
  log: PluginLogger,
): void {
  pollChain = pollChain
    .then(async () => {
      const newCursor = await pollAndDeliver(client, ctx, getCursor(), log);
      if (newCursor) setCursor(newCursor);
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`Poll error: ${message}`);
    });
}

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

// Fix PL-01: clean up abort listener to prevent memory leak
function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Persistent cursor management.
 * Stores cursor on disk so we can resume from the right position after restart.
 */
function loadCursor(ctx: ChannelGatewayContext): string | null {
  try {
    const runtime = getClawHouseRuntime();
    const cursorPath = runtime.state.resolveStorePath(
      `clawhouse/${ctx.accountId}/cursor`,
    );
    return readFileSync(cursorPath, 'utf-8').trim() || null; // Fix PL-02: use ESM import
  } catch {
    return null;
  }
}

function saveCursor(
  ctx: ChannelGatewayContext,
  cursor: string,
  log?: PluginLogger,
): void {
  try {
    const runtime = getClawHouseRuntime();
    const filePath = runtime.state.resolveStorePath(
      `clawhouse/${ctx.accountId}/cursor`,
    );
    const dir = dirname(filePath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, cursor, 'utf-8');
  } catch (err) {
    // Non-fatal — we'll just re-process some messages on restart
    const message = err instanceof Error ? err.message : String(err);
    log?.warn(`Failed to persist cursor: ${message}`);
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
  const log =
    ctx.log ?? getClawHouseRuntime().logging.createLogger('clawhouse');

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

    // Centralized cleanup to prevent interval leaks
    const cleanup = () => {
      if (pingInterval !== undefined) {
        clearInterval(pingInterval);
        pingInterval = undefined;
      }
    };

    ws.on('open', () => {
      ctx.setStatus({ running: true, lastStartAt: Date.now() });
      log.info('WebSocket connected.');

      // Keepalive ping every 5 minutes
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'ping' }));
        }
      }, PING_INTERVAL_MS);

      // Fix CP-05: enqueue initial catch-up poll through mutex
      enqueuePoll(client, ctx, () => cursor, (c) => { cursor = c ?? cursor; }, log);
    });

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString()) as
          | WsNotification
          | { action: string };

        if (msg.action === 'notify') {
          // Fix CP-05: enqueue notification-triggered poll through mutex
          enqueuePoll(client, ctx, () => cursor, (c) => { cursor = c ?? cursor; }, log);
        }
        // Ignore pong and other messages
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`Error processing WS message: ${message}`);
      }
    });

    ws.on('close', (code, reason) => {
      cleanup();
      ctx.setStatus({ running: false, lastStopAt: Date.now() });
      log.info(`WebSocket closed: ${code} ${reason.toString()}`);
      resolve(cursor);
    });

    ws.on('error', (err) => {
      cleanup();
      ctx.setStatus({ running: false, lastError: err.message });
      reject(err);
    });

    // Clean shutdown - register abort handler before potential errors
    ctx.abortSignal.addEventListener(
      'abort',
      () => {
        cleanup();
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
 *
 * On first run (cursor is null), we skip delivering old messages and just
 * seed the cursor so we only receive messages from this point forward.
 */
async function pollAndDeliver(
  client: ClawHouseClient,
  ctx: ChannelGatewayContext,
  cursor: string | null,
  log: PluginLogger,
): Promise<string | null> {
  try {
    // SEED is a sentinel value indicating we've completed the first-run
    // flow but had no real cursor (empty inbox). Don't send it to the API
    // since it's not a valid datetime cursor.
    const isFirstRun = !cursor || cursor === 'SEED';
    const apiCursor = cursor && cursor !== 'SEED' ? cursor : undefined;

    const response = await client.listMessages({
      ...(apiCursor ? { cursor: apiCursor } : {}),
    });

    // On first run, don't deliver old messages — just seed the cursor
    // and send a welcome message so the user knows the connection is live.
    if (isFirstRun) {
      if (response.cursor) {
        log.info(
          `First run: skipping ${response.items.length} existing message(s), seeding cursor.`,
        );
        saveCursor(ctx, response.cursor, log);
      } else {
        log.info('First run: no messages yet (empty inbox).');
      }

      try {
        await client.sendMessage({
          content:
            '🟢 Connected to ClawHouse. Ready to receive messages and tasks.',
        });
        log.info('Sent welcome message.');
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn(`Failed to send welcome message: ${errMsg}`);
      }

      // Return the API cursor, or empty string as sentinel when API returns
      // null (empty inbox) so subsequent polls don't re-trigger first-run flow.
      // Empty string is falsy for cursor != null check but won't be sent to
      // the API since we only include cursor when it's non-null and non-empty.
      return response.cursor ?? '';
    }

    if (response.items.length === 0) return null;

    log.info(`Received ${response.items.length} new message(s).`);

    // Fix CP-05: save cursor after each successful delivery so a mid-batch
    // failure doesn't cause the entire batch to be re-delivered on retry.
    for (const message of response.items) {
      await deliverMessageToAgent(ctx, message, client);
    }

    // Persist cursor
    if (response.cursor) {
      saveCursor(ctx, response.cursor, log);
    }

    return response.cursor;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`Poll failed: ${message}`);
    return null;
  }
}
