import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import xlsx from "xlsx";
import { normalizeWhitespace, truncateText } from "../utils.js";

export interface ParsedAssetText {
  text: string;
  parser: string;
  warnings: string[];
}

function extractPptxTextFromXml(xml: string): string {
  const matches = [...xml.matchAll(/<a:t>(.*?)<\/a:t>/g)];
  return matches.map((match) => match[1]).join(" ");
}

export async function extractTextFromAsset(storagePath: string, mimeType: string | null): Promise<ParsedAssetText> {
  const extension = path.extname(storagePath).toLowerCase();
  const warnings: string[] = [];

  if (mimeType?.startsWith("text/") || [".txt", ".md", ".csv", ".json"].includes(extension)) {
    const content = await fs.readFile(storagePath, "utf8");
    return { text: normalizeWhitespace(content), parser: "plain-text", warnings };
  }

  if (mimeType === "application/pdf" || extension === ".pdf") {
    const buffer = await fs.readFile(storagePath);
    const parsed = await pdfParse(buffer);
    return { text: normalizeWhitespace(parsed.text), parser: "pdf-parse", warnings };
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === ".docx"
  ) {
    const parsed = await mammoth.extractRawText({ path: storagePath });
    return { text: normalizeWhitespace(parsed.value), parser: "mammoth", warnings };
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    extension === ".xlsx" ||
    extension === ".xls"
  ) {
    const workbook = xlsx.readFile(storagePath);
    const text = workbook.SheetNames.map((sheetName) => {
      const rows = xlsx.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[sheetName], {
        defval: ""
      });
      return [`# ${sheetName}`, JSON.stringify(rows)].join("\n");
    }).join("\n\n");
    return { text: normalizeWhitespace(text), parser: "xlsx", warnings };
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    extension === ".pptx"
  ) {
    const buffer = await fs.readFile(storagePath);
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files).filter((fileName) => fileName.startsWith("ppt/slides/slide"));
    const slides = await Promise.all(
      slideFiles.sort().map(async (fileName) => {
        const xml = await zip.files[fileName].async("string");
        return extractPptxTextFromXml(xml);
      })
    );
    return { text: normalizeWhitespace(slides.join("\n")), parser: "pptx-zip", warnings };
  }

  if (mimeType?.startsWith("image/")) {
    warnings.push("Image OCR is not implemented yet. Add a vision pipeline in phase two.");
    return { text: "", parser: "image-placeholder", warnings };
  }

  if (mimeType?.startsWith("audio/") || mimeType?.startsWith("video/")) {
    warnings.push("Audio or video transcription is not implemented yet. Add ffmpeg and transcription in phase two.");
    return { text: "", parser: "media-placeholder", warnings };
  }

  warnings.push(`No parser matched ${(mimeType ?? extension) || "unknown format"}.`);
  return { text: "", parser: "unsupported", warnings };
}

export function buildAssetSummaryText(fileName: string | null, parsedText: ParsedAssetText): string {
  const body = parsedText.text || "";
  const prefix = fileName ? `${fileName}. ` : "";
  return normalizeWhitespace(`${prefix}${truncateText(body, 6000)}`);
}
