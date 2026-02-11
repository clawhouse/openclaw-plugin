import { ClawHouseClient } from './client';
import { getClawHouseRuntime } from './runtime';
import type {
  ChannelGatewayContext,
  ChatMessage,
  ChatMessageAttachment,
  PluginLogger,
  PluginRuntime,
} from './types';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Downloads a file from a signed S3 URL and saves it to the plugin store.
 */
async function fetchAndSaveMedia(
  runtime: PluginRuntime,
  attachment: ChatMessageAttachment,
): Promise<{ path: string; contentType: string }> {
  const ext = extname(attachment.name) || '.bin';
  const fileName = `${randomUUID()}${ext}`;
  const filePath = runtime.state.resolveStorePath(`media/inbound/${fileName}`);

  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true });

  const response = await fetch(attachment.url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download attachment: ${response.status}`);
  }

  // Stream the response body to disk
  const nodeStream = Readable.fromWeb(response.body as never);
  const fileStream = createWriteStream(filePath);
  await pipeline(nodeStream, fileStream);

  return { path: filePath, contentType: attachment.contentType };
}

/**
 * Delivers a ClawHouse chat message to the OpenClaw agent pipeline.
 *
 * Each message produces a single inbound message.
 * If the message has a taskId, it's set as ThreadId for conversation threading.
 */
export async function deliverMessageToAgent(
  ctx: ChannelGatewayContext,
  message: ChatMessage,
  client: ClawHouseClient,
): Promise<void> {
  const runtime = getClawHouseRuntime();
  const log: PluginLogger =
    ctx.log ?? runtime.logging.createLogger('clawhouse:deliver');

  const peerId = message.userId.trim().toLowerCase();

  log.info(
    `Delivering message ${message.messageId} from ${message.userName ?? message.userId}` +
      (message.taskId ? ` (task: ${message.taskId})` : '') +
      `: "${message.content.slice(0, 80)}${message.content.length > 80 ? '…' : ''}"`,
  );

  // Download attachments if present
  const mediaPaths: string[] = [];
  const mediaTypes: string[] = [];
  const mediaUrls: string[] = [];

  for (const attachment of message.attachments ?? []) {
    if (!attachment.url) continue;
    try {
      const saved = await fetchAndSaveMedia(runtime, attachment);
      mediaPaths.push(saved.path);
      mediaTypes.push(saved.contentType);
      mediaUrls.push(saved.path);
    } catch {
      // Non-fatal — skip this attachment
    }
  }

  const msgCtx = runtime.channel.reply.finalizeInboundContext({
    Body: message.content,
    RawBody: message.content,
    ChatType: 'dm',
    Provider: 'clawhouse',
    Surface: 'clawhouse',
    Channel: 'clawhouse',
    From: message.userId,
    To: message.userId,
    MessageSid: message.messageId,
    ThreadId: message.taskId ?? undefined,
    Timestamp: message.createdAt,
    AccountId: ctx.accountId,
    FromName: message.userName ?? 'Unknown',
    SessionKey: `agent:main:clawhouse:dm:${peerId}`,
    // Backward-compatible: first attachment
    MediaPath: mediaPaths[0],
    MediaType: mediaTypes[0],
    MediaUrl: mediaUrls[0],
    // Array keys for multiple attachments
    MediaPaths: mediaPaths,
    MediaTypes: mediaTypes,
    MediaUrls: mediaUrls,
    MediaCount: mediaPaths.length,
  });

  try {
    const cfg = runtime.config.loadConfig();
    const { dispatcher, replyOptions } =
      runtime.channel.reply.createReplyDispatcherWithTyping({
        channel: 'clawhouse',
        accountId: ctx.accountId,
        deliver: async (payload: { text?: string; body?: string }) => {
          const text =
            typeof payload === 'string'
              ? payload
              : (payload.text ?? payload.body ?? '');
          if (text) {
            await client.sendMessage({
              content: text,
              taskId: message.taskId ?? undefined,
            });
          }
        },
      });

    await runtime.channel.reply.dispatchReplyFromConfig({
      ctx: msgCtx,
      cfg,
      dispatcher,
      replyOptions,
    });

    log.info(`Message ${message.messageId} dispatched successfully.`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    log.warn(`Failed to dispatch message ${message.messageId}: ${errMsg}`);
  }
}
