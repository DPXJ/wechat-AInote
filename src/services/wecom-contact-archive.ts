import fs from "node:fs/promises";
import { archiveService } from "./archive.js";
import { buildAssetSummaryText, extractTextFromAsset } from "./parser.js";
import { storageService } from "./storage.js";
import { ArchiveEntryRecord, JsonValue, MessageType } from "../types.js";
import { normalizeWhitespace } from "../utils.js";

interface ArchiveFileMetadata {
  filename?: string;
  name?: string;
  sdkfileid?: string;
  md5sum?: string;
  filesize?: string | number;
}

interface ArchiveLinkMetadata {
  title?: string;
  desc?: string;
  url?: string;
  link_url?: string;
}

interface ArchiveLocationMetadata {
  title?: string;
  address?: string;
  name?: string;
}

interface InlineAttachmentPayload {
  fileName?: string;
  mimeType?: string | null;
  base64?: string;
  filePath?: string;
  kind?: string;
  metadata?: JsonValue;
}

export interface WecomContactArchiveMessage {
  msgid: string;
  msgtime: string | number;
  msgtype: string;
  from?: string;
  tolist?: string[];
  roomid?: string;
  action?: string;
  text?: { content?: string };
  link?: ArchiveLinkMetadata;
  location?: ArchiveLocationMetadata;
  image?: ArchiveFileMetadata;
  file?: ArchiveFileMetadata;
  video?: ArchiveFileMetadata;
  voice?: ArchiveFileMetadata;
  external_userid?: string;
  contact_account_id?: string;
  source_label?: string;
  attachment?: InlineAttachmentPayload;
}

export interface WecomContactArchiveImportPayload {
  messages: WecomContactArchiveMessage[];
}

function asJsonObject(input: JsonValue | undefined): Record<string, JsonValue> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, JsonValue>;
  }
  return {};
}

async function loadInlineAttachmentBuffer(payload: InlineAttachmentPayload): Promise<Buffer | null> {
  if (payload.base64) {
    return Buffer.from(payload.base64, "base64");
  }

  if (payload.filePath) {
    return fs.readFile(payload.filePath);
  }

  return null;
}

function normalizeArchiveMessageType(msgType: string): MessageType {
  const normalized = String(msgType || "").trim().toLowerCase();
  if (
    normalized === "text" ||
    normalized === "image" ||
    normalized === "voice" ||
    normalized === "video" ||
    normalized === "file" ||
    normalized === "location" ||
    normalized === "link" ||
    normalized === "business_card" ||
    normalized === "miniprogram" ||
    normalized === "msgmenu" ||
    normalized === "merged_msg" ||
    normalized === "event"
  ) {
    return normalized;
  }
  return "unknown";
}

function buildMessageText(message: WecomContactArchiveMessage): string {
  const msgType = normalizeArchiveMessageType(message.msgtype);
  if (msgType === "text") {
    return normalizeWhitespace(message.text?.content ?? "");
  }
  if (msgType === "link") {
    return normalizeWhitespace([message.link?.title, message.link?.desc, message.link?.url, message.link?.link_url].filter(Boolean).join(" "));
  }
  if (msgType === "location") {
    return normalizeWhitespace([message.location?.title, message.location?.name, message.location?.address].filter(Boolean).join(" "));
  }
  return "";
}

function getAttachmentMetadata(message: WecomContactArchiveMessage): {
  fileName: string | null;
  metadata: JsonValue;
  sizeBytes: number | null;
} | null {
  const msgType = normalizeArchiveMessageType(message.msgtype);
  const container =
    msgType === "image" ? message.image :
    msgType === "file" ? message.file :
    msgType === "video" ? message.video :
    msgType === "voice" ? message.voice :
    null;

  if (!container) {
    return null;
  }

  const sizeValue = container.filesize;
  const sizeBytes =
    typeof sizeValue === "number"
      ? sizeValue
      : typeof sizeValue === "string" && sizeValue.trim()
        ? Number(sizeValue)
        : null;

  return {
    fileName: container.filename ?? container.name ?? null,
    sizeBytes: Number.isFinite(sizeBytes ?? NaN) ? sizeBytes : null,
    metadata: {
      sdkfileid: container.sdkfileid ?? null,
      md5sum: container.md5sum ?? null,
      filesize: sizeBytes ?? null
    }
  };
}

function deriveSourceAccountId(message: WecomContactArchiveMessage): string {
  if (message.contact_account_id) {
    return message.contact_account_id;
  }
  if (message.roomid) {
    return `wecom-contact-room:${message.roomid}`;
  }
  if (message.source_label) {
    return `wecom-contact:${message.source_label}`;
  }
  if (message.from) {
    return `wecom-contact:${message.from}`;
  }
  return "wecom-contact-archive";
}

function buildPlaceholderAttachmentSummary(message: WecomContactArchiveMessage): {
  summaryText: string;
  warningMessage: string;
} | null {
  const metadata = getAttachmentMetadata(message);
  if (!metadata) {
    return null;
  }

  const descriptor = [
    "Attachment metadata imported",
    metadata.fileName ? `file=${metadata.fileName}` : null,
    metadata.sizeBytes ? `size=${metadata.sizeBytes}` : null,
    typeof metadata.metadata === "object" && metadata.metadata && "sdkfileid" in metadata.metadata
      ? `sdkfileid=${String((metadata.metadata as { sdkfileid?: string | null }).sdkfileid ?? "")}`
      : null
  ]
    .filter(Boolean)
    .join("; ");

  return {
    summaryText: descriptor,
    warningMessage: "Chat archive metadata was imported, but the binary attachment has not been fetched yet."
  };
}

export class WecomContactArchiveService {
  async importMessages(payload: WecomContactArchiveImportPayload): Promise<{
    importedMessages: number;
    importedAssets: number;
    skippedMessages: number;
  }> {
    let importedMessages = 0;
    let importedAssets = 0;
    let skippedMessages = 0;

    for (const message of payload.messages) {
      const msgType = normalizeArchiveMessageType(message.msgtype);
      let baseText = buildMessageText(message);
      let warningMessage: string | null = null;
      let entryStatus: ArchiveEntryRecord["status"] = "ready";
      let asset: Parameters<typeof archiveService.ingestCanonicalRecord>[0]["asset"] = null;

      if (message.attachment) {
        try {
          const fileName = message.attachment.fileName ?? getAttachmentMetadata(message)?.fileName ?? `${msgType}-${message.msgid}.bin`;
          const buffer = await loadInlineAttachmentBuffer(message.attachment);
          if (!buffer) {
            throw new Error("Attachment payload must provide base64 or filePath.");
          }
          const saved = await storageService.saveBuffer(fileName, buffer, "contact-archive");
          const parsed = await extractTextFromAsset(saved.storagePath, saved.mimeType);
          const extractedText = buildAssetSummaryText(saved.fileName, parsed);
          baseText = normalizeWhitespace([baseText, extractedText].filter(Boolean).join("\n\n"));
          if (parsed.warnings.length) {
            entryStatus = "warning";
            warningMessage = parsed.warnings.join(" ");
          }
          asset = {
            kind: message.attachment.kind ?? msgType,
            fileName: saved.fileName,
            mimeType: message.attachment.mimeType ?? saved.mimeType,
            sizeBytes: saved.sizeBytes,
            storagePath: saved.storagePath,
            extractedText,
            sha256: saved.sha256,
            metadata: {
              ...asJsonObject(message.attachment.metadata),
              importedFrom: "wecom-contact-archive",
              msgtype: msgType,
              filePath: message.attachment.filePath ?? null
            }
          };
          importedAssets += 1;
        } catch (error) {
          entryStatus = "warning";
          warningMessage = `Archive attachment import failed: ${error instanceof Error ? error.message : "unknown error"}`;
        }
      } else {
        const placeholder = buildPlaceholderAttachmentSummary(message);
        if (placeholder) {
          baseText = normalizeWhitespace([baseText, placeholder.summaryText].filter(Boolean).join("\n\n"));
          entryStatus = "warning";
          warningMessage = placeholder.warningMessage;
        }
      }

      const archiveEntry = await archiveService.ingestCanonicalRecord({
        msgId: message.msgid,
        sourceAccountId: deriveSourceAccountId(message),
        externalUserId: message.external_userid ?? null,
        sourcePayload: message as unknown as JsonValue,
        msgType,
        sourceType: msgType,
        sendTime: Number(message.msgtime) || Math.floor(Date.now() / 1000),
        baseText,
        warningMessage,
        entryStatus,
        asset
      });

      if (archiveEntry) {
        importedMessages += 1;
      } else {
        skippedMessages += 1;
      }
    }

    return {
      importedMessages,
      importedAssets,
      skippedMessages
    };
  }
}

export const wecomContactArchiveService = new WecomContactArchiveService();
