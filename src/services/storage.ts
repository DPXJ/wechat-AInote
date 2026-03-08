import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import mime from "mime-types";
import { appConfig } from "../config.js";

export interface SavedBinary {
  storagePath: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  mimeType: string | null;
}

export class LocalStorageService {
  async saveBuffer(fileName: string, buffer: Buffer, subfolder = "incoming"): Promise<SavedBinary> {
    const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
    const timePrefix = new Date().toISOString().slice(0, 10);
    const dirPath = path.join(appConfig.storageDir, subfolder, timePrefix);
    await fs.mkdir(dirPath, { recursive: true });

    const sanitizedName = fileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
    const finalPath = path.join(dirPath, `${sha256.slice(0, 12)}-${sanitizedName}`);
    await fs.writeFile(finalPath, buffer);

    return {
      storagePath: finalPath,
      fileName: sanitizedName,
      sizeBytes: buffer.byteLength,
      sha256,
      mimeType: mime.lookup(sanitizedName) || null
    };
  }

  async readBuffer(storagePath: string): Promise<Buffer> {
    return fs.readFile(storagePath);
  }
}

export const storageService = new LocalStorageService();
