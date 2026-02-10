import { ClawHouseClient } from './client';
import { getClawHouseRuntime } from './runtime';
import type { ChannelGatewayContext, ChatMessage, PluginLogger } from './types';

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
