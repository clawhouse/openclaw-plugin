import {
  createTypingCallbacks,
  logTypingFailure,
} from 'openclaw/plugin-sdk';

import { ClawHouseClient } from './client';
import { resolvePluginStorePath } from './paths';
import { getClawHouseRuntime } from './runtime';
import type {
  ChannelGatewayContext,
  ChatMessage,
  ChatMessageAttachment,
  PluginLogger,
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

// Rate limiting: maximum attachments per message
const MAX_ATTACHMENTS_PER_MESSAGE = 10;

// Rate limiting: maximum total download size per message (50MB)
const MAX_TOTAL_DOWNLOAD_SIZE = 50 * 1024 * 1024;

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
    
    // Block localhost and private IP ranges
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      throw new Error('Local URLs are not allowed');
    }
    
    // Block private IP ranges (RFC 1918 and others)
    const ipv4Patterns = [
      /^10\./,           // 10.0.0.0/8
      /^192\.168\./,     // 192.168.0.0/16
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // 172.16.0.0/12
      /^169\.254\./,     // Link-local 169.254.0.0/16
      /^0\./,            // Current network
      /^127\./,          // Loopback
    ];
    
    for (const pattern of ipv4Patterns) {
      if (pattern.test(hostname)) {
        throw new Error('Private IP addresses are not allowed');
      }
    }
    
    // Validate URL length to prevent DoS
    if (url.length > 2048) {
      throw new Error('URL too long (max 2048 characters)');
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

  // Generate safe file path with additional security checks
  const sanitizedName = sanitizeFileName(attachment.name);
  
  // Additional validation - ensure no path traversal attempts
  if (sanitizedName.includes('..') || sanitizedName.includes('/') || sanitizedName.includes('\\')) {
    throw new Error('Invalid filename: contains path traversal characters');
  }
  
  // Only append extension if the sanitized name doesn't already have one
  const hasExt = extname(sanitizedName).length > 0;
  const fileName = hasExt
    ? `${randomUUID()}_${sanitizedName}`
    : `${randomUUID()}_${sanitizedName}${extname(attachment.name) || '.bin'}`;
  
  // Final validation of complete filename
  if (fileName.length > 255) {
    throw new Error('Generated filename too long (max 255 characters)');
  }
  
  const filePath = resolvePluginStorePath(`media/inbound/${fileName}`);

  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true });

  // Download with timeout and validations
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  let fileStream: ReturnType<typeof createWriteStream> | null = null;

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
    fileStream = createWriteStream(filePath);

    let bytesWritten = 0;
    let sizeExceeded = false;
    
    nodeStream.on('data', (chunk) => {
      bytesWritten += chunk.length;
      if (bytesWritten > MAX_ATTACHMENT_SIZE && !sizeExceeded) {
        sizeExceeded = true;
        nodeStream.destroy(new Error('File size limit exceeded during download'));
      }
    });

    // Handle stream errors properly
    nodeStream.on('error', (err) => {
      if (fileStream && !fileStream.destroyed) {
        fileStream.destroy();
      }
    });

    fileStream.on('error', (err) => {
      if (!nodeStream.destroyed) {
        nodeStream.destroy();
      }
    });

    await pipeline(nodeStream, fileStream);

    return {
      path: filePath,
      contentType: responseContentType || attachment.contentType,
    };

  } catch (error) {
    // Ensure streams are properly closed
    if (fileStream && !fileStream.destroyed) {
      fileStream.destroy();
      fileStream = null;
    }

    // Clean up partial file if download failed
    try {
      // Use fs.promises import instead of require for better type safety
      const fs = await import('node:fs');
      await fs.promises.unlink(filePath);
    } catch {
      // Ignore cleanup errors - file might not have been created
    }

    if (controller.signal.aborted) {
      throw new Error(`Download timeout after ${DOWNLOAD_TIMEOUT_MS}ms`);
    }

    throw new Error(`Failed to download attachment: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timeoutId);
    // Final cleanup - ensure file stream is closed
    if (fileStream && !fileStream.destroyed) {
      fileStream.destroy();
    }
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
  const attachments = message.attachments ?? [];
  
  // Validate attachment count
  if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    log.warn(`Message has ${attachments.length} attachments, limiting to ${MAX_ATTACHMENTS_PER_MESSAGE}`);
  }
  
  // Calculate total attachment size for rate limiting
  const totalSize = attachments
    .slice(0, MAX_ATTACHMENTS_PER_MESSAGE)
    .reduce((sum, att) => sum + (att.size || 0), 0);
    
  if (totalSize > MAX_TOTAL_DOWNLOAD_SIZE) {
    log.warn(`Total attachment size ${totalSize} bytes exceeds limit ${MAX_TOTAL_DOWNLOAD_SIZE} bytes`);
    // Don't fail the entire message, just log the warning
  }

  const mediaPaths: string[] = [];
  const mediaTypes: string[] = [];
  const mediaUrls: string[] = [];

  for (const [index, attachment] of attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE).entries()) {
    if (!attachment.url) {
      log.warn(`Skipping attachment ${index}: no URL provided`);
      continue;
    }

    try {
      const saved = await fetchAndSaveMedia(attachment);
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

    const typingCallbacks = createTypingCallbacks({
      start: async () => {
        await client.typing({ taskId: message.taskId ?? undefined });
      },
      onStartError: (err) => {
        logTypingFailure({
          log: (m) => log.warn(m),
          channel: 'clawhouse',
          action: 'start',
          error: err,
        });
      },
    });

    const { dispatcher, replyOptions } =
      runtime.channel.reply.createReplyDispatcherWithTyping({
        channel: 'clawhouse',
        accountId: ctx.accountId,
        onReplyStart: typingCallbacks.onReplyStart,
        onIdle: typingCallbacks.onIdle,
        deliver: async (payload: { text?: string; body?: string }) => {
          const text =
            typeof payload === 'string'
              ? payload
              : (payload.text ?? payload.body ?? '');
          if (text) {
            log.info(
              `Sending reply to ClawHouse (task: ${message.taskId ?? 'none'}): "${text.slice(0, 80)}..."`,
            );
            await client.sendMessage({
              content: text,
              taskId: message.taskId ?? undefined,
            });
            log.info('Reply sent successfully.');
          } else {
            log.warn('Deliver callback called with empty text, skipping.');
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
