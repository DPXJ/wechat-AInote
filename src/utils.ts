import crypto from "node:crypto";

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function chunkText(input: string, maxLength = 6000): string[] {
  if (input.length <= maxLength) {
    return [input];
  }

  const chunks: string[] = [];
  let index = 0;
  while (index < input.length) {
    chunks.push(input.slice(index, index + maxLength));
    index += maxLength;
  }
  return chunks;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function truncateText(input: string, maxLength = 240): string {
  if (input.length <= maxLength) {
    return input;
  }
  return `${input.slice(0, maxLength - 1)}...`;
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}
