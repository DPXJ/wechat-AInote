export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type MessageType =
  | "text"
  | "image"
  | "voice"
  | "video"
  | "file"
  | "location"
  | "link"
  | "business_card"
  | "miniprogram"
  | "msgmenu"
  | "merged_msg"
  | "event"
  | "unknown";

export interface RawMessageRecord {
  id: string;
  msgId: string;
  openKfId: string;
  externalUserId: string | null;
  sourcePayload: JsonValue;
  msgType: MessageType;
  sendTime: number;
  createdAt: string;
}

export interface AssetRecord {
  id: string;
  archiveEntryId: string | null;
  rawMessageId: string;
  kind: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  storagePath: string;
  extractedText: string | null;
  sha256: string | null;
  metadata: JsonValue;
  createdAt: string;
}

export interface ArchiveEntryRecord {
  id: string;
  rawMessageId: string;
  openKfId: string;
  externalUserId: string | null;
  sourceType: MessageType;
  title: string;
  summary: string | null;
  content: string;
  keywords: string[];
  tags: string[];
  status: "ready" | "warning" | "failed";
  warningMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TodoRecord {
  id: string;
  archiveEntryId: string;
  title: string;
  dueAt: string | null;
  assignee: string | null;
  evidence: string | null;
  confidence: number;
  status: "open" | "done" | "dismissed";
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SearchResultItem {
  id: string;
  title: string;
  summary: string | null;
  sourceType: string;
  createdAt: string;
  score: number;
  keywords: string[];
  tags: string[];
  warningMessage: string | null;
}

export interface ArchiveAnalysis {
  title: string;
  summary: string;
  keywords: string[];
  tags: string[];
  todoCandidates: Array<{
    title: string;
    dueAt: string | null;
    assignee: string | null;
    evidence: string;
    confidence: number;
  }>;
  answerHints: string[];
}
