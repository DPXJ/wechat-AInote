import fs from "node:fs/promises";
import path from "node:path";
import { appConfig } from "../config.js";
import {
  WecomContactArchiveImportPayload,
  WecomContactArchiveMessage,
  wecomContactArchiveService
} from "./wecom-contact-archive.js";

interface ArchiveInboxEnvelope {
  messages?: unknown;
  attachmentsRoot?: string;
}

export interface ContactArchiveInboxRunResult {
  pendingFiles: number;
  processedFiles: number;
  failedFiles: number;
  importedMessages: number;
  importedAssets: number;
  skippedMessages: number;
  failures: Array<{
    fileName: string;
    error: string;
  }>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMessages(input: unknown): WecomContactArchiveMessage[] {
  if (!Array.isArray(input)) {
    throw new Error("Archive inbox JSON must contain a messages array.");
  }

  return input as WecomContactArchiveMessage[];
}

function resolveAttachmentFilePath(
  message: WecomContactArchiveMessage,
  baseDir: string,
  attachmentsRoot?: string
): WecomContactArchiveMessage {
  if (!message.attachment?.filePath) {
    return message;
  }

  if (path.isAbsolute(message.attachment.filePath)) {
    return message;
  }

  return {
    ...message,
    attachment: {
      ...message.attachment,
      filePath: path.resolve(attachmentsRoot ? path.resolve(baseDir, attachmentsRoot) : baseDir, message.attachment.filePath)
    }
  };
}

async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function moveFile(sourcePath: string, targetDir: string): Promise<void> {
  await ensureDirectory(targetDir);
  const fileName = path.basename(sourcePath);
  const targetPath = path.join(targetDir, `${Date.now()}-${fileName}`);
  await fs.rename(sourcePath, targetPath);
}

export class WecomContactArchiveInboxService {
  async runOnce(): Promise<ContactArchiveInboxRunResult> {
    await ensureDirectory(appConfig.wecomArchiveInboxDir);
    await ensureDirectory(appConfig.wecomArchiveProcessedDir);
    await ensureDirectory(appConfig.wecomArchiveFailedDir);

    const entries = await fs.readdir(appConfig.wecomArchiveInboxDir, { withFileTypes: true });
    const jsonFiles = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => path.join(appConfig.wecomArchiveInboxDir, entry.name))
      .sort((a, b) => a.localeCompare(b));

    const result: ContactArchiveInboxRunResult = {
      pendingFiles: jsonFiles.length,
      processedFiles: 0,
      failedFiles: 0,
      importedMessages: 0,
      importedAssets: 0,
      skippedMessages: 0,
      failures: []
    };

    for (const filePath of jsonFiles) {
      try {
        const payload = await this.readPayload(filePath);
        const importResult = await wecomContactArchiveService.importMessages(payload);
        result.processedFiles += 1;
        result.importedMessages += importResult.importedMessages;
        result.importedAssets += importResult.importedAssets;
        result.skippedMessages += importResult.skippedMessages;
        await moveFile(filePath, appConfig.wecomArchiveProcessedDir);
      } catch (error) {
        result.failedFiles += 1;
        result.failures.push({
          fileName: path.basename(filePath),
          error: error instanceof Error ? error.message : "Unknown import error"
        });
        await moveFile(filePath, appConfig.wecomArchiveFailedDir);
      }
    }

    return result;
  }

  private async readPayload(filePath: string): Promise<WecomContactArchiveImportPayload> {
    const rawText = (await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
    const parsed = JSON.parse(rawText) as unknown;
    const baseDir = path.dirname(filePath);

    if (Array.isArray(parsed)) {
      return {
        messages: parsed.map((message) => resolveAttachmentFilePath(message as WecomContactArchiveMessage, baseDir))
      };
    }

    if (!isObject(parsed)) {
      throw new Error("Archive inbox JSON must be an array or an object.");
    }

    const envelope = parsed as ArchiveInboxEnvelope;
    const attachmentsRoot = typeof envelope.attachmentsRoot === "string" && envelope.attachmentsRoot.trim()
      ? envelope.attachmentsRoot.trim()
      : undefined;

    return {
      messages: normalizeMessages(envelope.messages).map((message) =>
        resolveAttachmentFilePath(message, baseDir, attachmentsRoot)
      )
    };
  }
}

export const wecomContactArchiveInboxService = new WecomContactArchiveInboxService();
