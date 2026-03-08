import mime from "mime-types";
import { extractTextFromAsset, buildAssetSummaryText } from "./parser.js";
import { aiService } from "./ai.js";
import { repositories } from "../repositories.js";
import { storageService } from "./storage.js";
import { wecomService, NormalizedWecomMessage } from "./wecom.js";
import { ArchiveEntryRecord, AssetRecord, RawMessageRecord, TodoRecord } from "../types.js";
import { generateId, nowIso, normalizeWhitespace, truncateText } from "../utils.js";

export type ArchivedEntry = ArchiveEntryRecord & { answerHints: string[] };

function inferFileName(message: NormalizedWecomMessage, contentDisposition: string | null, contentType: string | null): string {
  const dispositionName = contentDisposition?.match(/filename="?([^"]+)"?/)?.[1];
  if (dispositionName) {
    return dispositionName;
  }
  if (message.fileName) {
    return message.fileName;
  }

  const extension = mime.extension(contentType || "") || "bin";
  return `${message.msgType}-${message.msgId}.${extension}`;
}

function buildCanonicalContent(baseText: string, assetText: string): string {
  return normalizeWhitespace([baseText, assetText].filter(Boolean).join("\n\n"));
}

function likelyOversizeFallback(message: NormalizedWecomMessage): string | null {
  if (message.msgType !== "text") {
    return null;
  }

  const content = message.textContent;
  if (/\u6587\u4ef6.+\u8fc7\u5927|\u89c6\u9891.+\u8fc7\u5927|\u8d85\u8fc7.+\u9650\u5236|\u65e0\u6cd5\u67e5\u770b\u8be5\u6d88\u606f|over limit|too large/i.test(content)) {
    return "WeCom likely returned a fallback text because the original asset exceeded the direct sync limit. Ask the user to use the fallback upload entry.";
  }
  return null;
}

export function isOversizeWarning(warningMessage: string | null): boolean {
  if (!warningMessage) {
    return false;
  }

  return /fallback upload entry|\u8d85\u8fc7.+\u9650\u5236|\u8fc7\u5927|over limit|too large/i.test(warningMessage);
}

export class ArchiveService {
  private async persistArchiveFromCanonicalSource(input: {
    rawRecord: RawMessageRecord;
    sourceType: ArchiveEntryRecord["sourceType"];
    baseText: string;
    assetRecord: AssetRecord | null;
    warningMessage: string | null;
    entryStatus: ArchiveEntryRecord["status"];
  }): Promise<ArchivedEntry> {
    repositories.createRawMessage(input.rawRecord);

    const canonicalText = normalizeWhitespace(input.baseText) || "No extractable text found.";
    const analysis = await aiService.analyzeArchive(canonicalText);

    const archiveEntryId = generateId("entry");
    const createdAt = input.rawRecord.createdAt;
    const archiveRecord: ArchivedEntry = {
      id: archiveEntryId,
      rawMessageId: input.rawRecord.id,
      openKfId: input.rawRecord.openKfId,
      externalUserId: input.rawRecord.externalUserId,
      sourceType: input.sourceType,
      title: analysis.title || truncateText(canonicalText, 50),
      summary: analysis.summary,
      content: canonicalText,
      keywords: analysis.keywords,
      tags: analysis.tags,
      status: input.entryStatus,
      warningMessage: input.warningMessage,
      createdAt,
      updatedAt: createdAt,
      answerHints: analysis.answerHints
    };
    repositories.upsertArchiveEntry(archiveRecord);

    if (input.assetRecord) {
      repositories.createAsset({
        ...input.assetRecord,
        archiveEntryId
      });
    }

    const embedding = await aiService.createEmbedding(
      [archiveRecord.title, archiveRecord.summary ?? "", archiveRecord.content, analysis.answerHints.join(" ")].join("\n")
    );
    if (embedding.length) {
      repositories.upsertEmbedding(archiveEntryId, embedding);
    }

    const todoRecords: TodoRecord[] = analysis.todoCandidates.map((candidate) => ({
      id: generateId("todo"),
      archiveEntryId,
      title: candidate.title,
      dueAt: candidate.dueAt,
      assignee: candidate.assignee,
      evidence: candidate.evidence,
      confidence: candidate.confidence,
      status: "open",
      needsReview: candidate.confidence < 0.75,
      createdAt,
      updatedAt: createdAt
    }));
    repositories.replaceTodos(archiveEntryId, todoRecords);
    return archiveRecord;
  }

  async ingestNormalizedMessage(message: NormalizedWecomMessage): Promise<ArchivedEntry | null> {
    if (repositories.hasRawMessageByMsgId(message.msgId)) {
      return null;
    }

    const createdAt = nowIso();
    const rawMessageId = generateId("msg");
    const rawRecord: RawMessageRecord = {
      id: rawMessageId,
      msgId: message.msgId,
      openKfId: message.openKfId,
      externalUserId: message.externalUserId,
      sourcePayload: message.raw as RawMessageRecord["sourcePayload"],
      msgType: (message.msgType as RawMessageRecord["msgType"]) ?? "unknown",
      sendTime: message.sendTime,
      createdAt
    };

    let assetRecord: AssetRecord | null = null;
    let assetSummaryText = "";
    let warningMessage = likelyOversizeFallback(message);
    let entryStatus: ArchiveEntryRecord["status"] = warningMessage ? "warning" : "ready";

    if (message.mediaId) {
      try {
        const downloaded = await wecomService.downloadMedia(message.mediaId);
        const fileName = inferFileName(message, downloaded.contentDisposition, downloaded.contentType);
        const saved = await storageService.saveBuffer(fileName, downloaded.buffer, "assets");
        const parsed = await extractTextFromAsset(saved.storagePath, saved.mimeType);
        assetSummaryText = buildAssetSummaryText(fileName, parsed);
        if (parsed.warnings.length) {
          entryStatus = "warning";
          warningMessage = parsed.warnings.join(" ");
        }

        assetRecord = {
          id: generateId("asset"),
          archiveEntryId: null,
          rawMessageId,
          kind: message.msgType,
          fileName,
          mimeType: downloaded.contentType ?? saved.mimeType,
          sizeBytes: downloaded.sizeBytes,
          storagePath: saved.storagePath,
          extractedText: assetSummaryText,
          sha256: saved.sha256,
          metadata: {
            mediaId: message.mediaId,
            contentDisposition: downloaded.contentDisposition,
            parser: parsed.parser,
            warnings: parsed.warnings
          },
          createdAt
        };
      } catch (error) {
        entryStatus = "warning";
        warningMessage = `Media download failed: ${error instanceof Error ? error.message : "unknown error"}`;
      }
    }

    return this.persistArchiveFromCanonicalSource({
      rawRecord,
      sourceType: (message.msgType as ArchiveEntryRecord["sourceType"]) ?? "unknown",
      baseText: buildCanonicalContent(message.textContent, assetSummaryText),
      assetRecord,
      warningMessage,
      entryStatus
    });
  }

  async ingestManualUpload(input: { fileName: string; buffer: Buffer; note?: string | null }): Promise<ArchivedEntry> {
    const createdAt = nowIso();
    const rawMessageId = generateId("msg");
    const rawRecord: RawMessageRecord = {
      id: rawMessageId,
      msgId: generateId("upload"),
      openKfId: "manual-upload",
      externalUserId: null,
      sourcePayload: {
        source: "manual-upload",
        fileName: input.fileName,
        note: input.note ?? null
      },
      msgType: "file",
      sendTime: Math.floor(Date.now() / 1000),
      createdAt
    };

    const saved = await storageService.saveBuffer(input.fileName, input.buffer, "manual-uploads");
    const parsed = await extractTextFromAsset(saved.storagePath, saved.mimeType);
    const extractedText = buildAssetSummaryText(saved.fileName, parsed);
    const warningMessage = parsed.warnings.length ? parsed.warnings.join(" ") : null;
    const assetRecord: AssetRecord = {
      id: generateId("asset"),
      archiveEntryId: null,
      rawMessageId,
      kind: "manual-upload",
      fileName: saved.fileName,
      mimeType: saved.mimeType,
      sizeBytes: saved.sizeBytes,
      storagePath: saved.storagePath,
      extractedText,
      sha256: saved.sha256,
      metadata: {
        parser: parsed.parser,
        warnings: parsed.warnings,
        note: input.note ?? null
      },
      createdAt
    };

    return this.persistArchiveFromCanonicalSource({
      rawRecord,
      sourceType: "file",
      baseText: normalizeWhitespace([input.note ?? "", extractedText].filter(Boolean).join("\n\n")),
      assetRecord,
      warningMessage,
      entryStatus: warningMessage ? "warning" : "ready"
    });
  }
}

export const archiveService = new ArchiveService();
