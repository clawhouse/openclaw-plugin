import { getClawHouseRuntime } from './runtime';
import type { ChannelGatewayContext, ChatMessage } from './types';

/**
 * Delivers a ClawHouse chat message to the OpenClaw agent pipeline.
 *
 * Each message produces a single inbound message.
 * If the message has a taskId, it's set as ThreadId for conversation threading.
 */
export async function deliverMessageToAgent(
  ctx: ChannelGatewayContext,
  message: ChatMessage,
): Promise<void> {
  const runtime = getClawHouseRuntime();

  const msgCtx = runtime.channel.reply.finalizeInboundContext({
    Body: message.content,
    RawBody: message.content,
    ChatType: 'dm',
    Provider: 'clawhouse',
    Surface: 'clawhouse',
    From: message.userId,
    To: message.botId,
    MessageSid: message.messageId,
    ThreadId: message.taskId ?? undefined,
    Timestamp: message.createdAt,
    AccountId: ctx.accountId,
    FromName: message.userName ?? 'Unknown',
  });

  try {
    const cfg = runtime.config.loadConfig();
    const dispatcher = runtime.channel.reply.createReplyDispatcherWithTyping({
      channel: 'clawhouse',
      accountId: ctx.accountId,
    });

    await runtime.channel.reply.dispatchReplyFromConfig({
      ctx: msgCtx,
      cfg,
      dispatcher,
    });
  } catch {
    // Non-fatal — agent routing may not be configured yet
  }
}
