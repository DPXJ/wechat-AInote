import { repositories } from "../repositories.js";
import { appConfig } from "../config.js";
import { archiveService, ArchivedEntry, isOversizeWarning } from "./archive.js";
import { wecomService } from "./wecom.js";
import { normalizeWhitespace, truncateText } from "../utils.js";

function getCursorKey(openKfId: string): string {
  return `cursor:${openKfId}`;
}

function shouldAutoReply(input: { msgType: string; origin: number | null; externalUserId: string | null }): boolean {
  return input.msgType !== "event" && Boolean(input.externalUserId);
}

function buildReplyContent(entry: ArchivedEntry): string {
  if (isOversizeWarning(entry.warningMessage)) {
    return `\u8fd9\u4e2a\u6587\u4ef6\u8d85\u8fc7\u5fae\u4fe1\u8f6c\u53d1\u4e0a\u9650\uff0c\u6682\u672a\u5b8c\u6574\u5f52\u6863\u3002\u8bf7\u6539\u8d70\u8865\u4f20\u5165\u53e3\uff1a${appConfig.appUrl}/upload`;
  }

  const lines = [`\u5df2\u5f52\u6863\uff1a${truncateText(entry.title, 60)}`];
  const summary = normalizeWhitespace(entry.summary ?? "");
  if (summary) {
    lines.push(truncateText(summary, 140));
  }
  if (entry.status === "warning" && entry.warningMessage) {
    lines.push("\u63d0\u793a\uff1a\u90e8\u5206\u5185\u5bb9\u672a\u5b8c\u6574\u89e3\u6790\uff0c\u53ef\u5728\u7ba1\u7406\u53f0\u67e5\u770b\u539f\u59cb\u8d44\u6599\u3002");
  }
  return lines.join("\n");
}

export async function runSync(input: {
  openKfIds: string[];
  token?: string;
  autoReply?: boolean;
}): Promise<{
  syncedMessages: number;
  archivedMessages: number;
  autoReplies: number;
  openKfIds: string[];
}> {
  let syncedMessages = 0;
  let archivedMessages = 0;
  let autoReplies = 0;
  const token = input.token;
  const autoReply = input.autoReply ?? false;

  if (token && input.openKfIds.length !== 1) {
    throw new Error("Callback token sync only supports a single open_kfid per request.");
  }

  for (const openKfId of input.openKfIds) {
    let cursor = token ? undefined : repositories.getSetting(getCursorKey(openKfId)) ?? undefined;
    let hasMore = true;

    while (hasMore) {
      const batch = await wecomService.syncMessages(openKfId, cursor, token);
      syncedMessages += batch.messages.length;

      for (const message of batch.messages) {
        if (message.msgType === "event") {
          continue;
        }

        const archivedEntry = await archiveService.ingestNormalizedMessage(message);
        if (!archivedEntry) {
          continue;
        }

        archivedMessages += 1;
        const shouldReply = autoReply && shouldAutoReply(message);
        console.info("WeCom sync archived message", {
          openKfId: message.openKfId,
          msgId: message.msgId,
          msgType: message.msgType,
          origin: message.origin,
          externalUserId: message.externalUserId,
          shouldReply
        });

        if (!shouldReply) {
          continue;
        }

        try {
          await wecomService.sendTextMessage({
            externalUserId: message.externalUserId!,
            openKfId: message.openKfId,
            msgId: message.msgId,
            content: buildReplyContent(archivedEntry)
          });
          console.info("WeCom auto reply sent", {
            openKfId: message.openKfId,
            msgId: message.msgId,
            externalUserId: message.externalUserId
          });
          autoReplies += 1;
        } catch (error) {
          console.warn("WeCom auto reply failed", {
            openKfId: message.openKfId,
            msgId: message.msgId,
            msgType: message.msgType,
            origin: message.origin,
            externalUserId: message.externalUserId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      cursor = batch.nextCursor ?? undefined;
      if (!token && cursor) {
        repositories.setSetting(getCursorKey(openKfId), cursor);
      }
      hasMore = batch.hasMore;
    }
  }

  return {
    syncedMessages,
    archivedMessages,
    autoReplies,
    openKfIds: input.openKfIds
  };
}
