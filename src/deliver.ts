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

// Maximum file size for attachments (10MB)
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;

// Download timeout (30 seconds)
const DOWNLOAD_TIMEOUT_MS = 30 * 1000;

// Allowed content types for security
const ALLOWED_CONTENT_TYPES = [
  'image/',
  'video/',
  'audio/',
  'application/pdf',
  'text/',
  'application/json',
  'application/xml',
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
];

/**
 * Validates if a content type is safe to download.
 */
function isContentTypeAllowed(contentType: string): boolean {
  const normalized = contentType.toLowerCase().trim();
  return ALLOWED_CONTENT_TYPES.some(allowed => normalized.startsWith(allowed));
}

/**
 * Sanitizes a filename to prevent directory traversal and other security issues.
 */
function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_') // Replace unsafe chars with underscore
    .replace(/\.+/g, '.') // Replace multiple dots with single dot
    .replace(/^\./, '_') // Replace leading dot
    .substring(0, 100); // Limit length
}

/**
 * Validates a URL to ensure it's a proper HTTPS URL.
 */
function validateDownloadUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      throw new Error('Only HTTPS URLs are allowed');
    }
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      throw new Error('Local URLs are not allowed');
    }
  } catch (error) {
    throw new Error(`Invalid URL: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Downloads a file from a signed S3 URL and saves it to the plugin store.
 * Includes security validations and error handling.
 */
async function fetchAndSaveMedia(
  runtime: PluginRuntime,
  attachment: ChatMessageAttachment,
): Promise<{ path: string; contentType: string }> {
  // Validate input
  if (!attachment.url) {
    throw new Error('Attachment URL is required');
  }

  if (!attachment.name) {
    throw new Error('Attachment name is required');
  }

  if (!attachment.contentType) {
    throw new Error('Attachment content type is required');
  }

  // Security validations
  validateDownloadUrl(attachment.url);

  if (!isContentTypeAllowed(attachment.contentType)) {
    throw new Error(`Content type not allowed: ${attachment.contentType}`);
  }

  if (attachment.size > MAX_ATTACHMENT_SIZE) {
    throw new Error(`File too large: ${attachment.size} bytes (max: ${MAX_ATTACHMENT_SIZE})`);
  }

  // Generate safe file path
  const ext = extname(attachment.name) || '.bin';
  const sanitizedName = sanitizeFileName(attachment.name);
  const fileName = `${randomUUID()}_${sanitizedName}${ext}`;
  const filePath = runtime.state.resolveStorePath(`media/inbound/${fileName}`);

  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true });

  // Download with timeout and validations
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  try {
    const response = await fetch(attachment.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'ClawHouse-OpenClaw/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Empty response body');
    }

    // Validate content type from response
    const responseContentType = response.headers.get('content-type');
    if (responseContentType && !isContentTypeAllowed(responseContentType)) {
      throw new Error(`Response content type not allowed: ${responseContentType}`);
    }

    // Validate content length if provided
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (size > MAX_ATTACHMENT_SIZE) {
        throw new Error(`Content too large: ${size} bytes (max: ${MAX_ATTACHMENT_SIZE})`);
      }
    }

    // Stream the response body to disk with size tracking
    const nodeStream = Readable.fromWeb(response.body as never);
    const fileStream = createWriteStream(filePath);

    let bytesWritten = 0;
    nodeStream.on('data', (chunk) => {
      bytesWritten += chunk.length;
      if (bytesWritten > MAX_ATTACHMENT_SIZE) {
        nodeStream.destroy(new Error('File size limit exceeded during download'));
      }
    });

    await pipeline(nodeStream, fileStream);

    return {
      path: filePath,
      contentType: responseContentType || attachment.contentType,
    };

  } catch (error) {
    // Clean up partial file if download failed
    try {
      const fs = require('fs') as typeof import('fs');
      await fs.promises.unlink(filePath);
    } catch {
      // Ignore cleanup errors
    }

    if (controller.signal.aborted) {
      throw new Error(`Download timeout after ${DOWNLOAD_TIMEOUT_MS}ms`);
    }

    throw new Error(`Failed to download attachment: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeoutId);
  }
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

  for (const [index, attachment] of (message.attachments ?? []).entries()) {
    if (!attachment.url) {
      log.warn(`Skipping attachment ${index}: no URL provided`);
      continue;
    }

    try {
      const saved = await fetchAndSaveMedia(runtime, attachment);
      mediaPaths.push(saved.path);
      mediaTypes.push(saved.contentType);
      mediaUrls.push(saved.path);
      log.info(`Downloaded attachment ${index}: ${attachment.name} (${saved.contentType})`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log.warn(`Failed to download attachment ${index} (${attachment.name}): ${errorMsg}`);
      // Non-fatal — continue processing other attachments and the message
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
