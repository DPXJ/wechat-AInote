import { db } from "./db.js";
import {
  ArchiveEntryRecord,
  AssetRecord,
  RawMessageRecord,
  SearchResultItem,
  TodoRecord
} from "./types.js";
import { nowIso, safeJsonParse } from "./utils.js";

export const repositories = {
  getSetting(key: string): string | null {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  },

  setSetting(key: string, value: string): void {
    db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, nowIso());
  },

  createRawMessage(record: RawMessageRecord): void {
    db.prepare(`
      INSERT OR IGNORE INTO raw_messages (
        id, msg_id, open_kf_id, external_user_id, msg_type, send_time, source_payload, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.msgId,
      record.openKfId,
      record.externalUserId,
      record.msgType,
      record.sendTime,
      JSON.stringify(record.sourcePayload),
      record.createdAt
    );
  },

  hasRawMessageByMsgId(msgId: string): boolean {
    const row = db.prepare("SELECT id FROM raw_messages WHERE msg_id = ?").get(msgId) as { id: string } | undefined;
    return Boolean(row?.id);
  },

  upsertArchiveEntry(record: ArchiveEntryRecord & { answerHints: string[] }): void {
    db.prepare(`
      INSERT INTO archive_entries (
        id, raw_message_id, open_kf_id, external_user_id, source_type, title, summary, content,
        keywords_json, tags_json, answer_hints_json, status, warning_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(raw_message_id) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        content = excluded.content,
        keywords_json = excluded.keywords_json,
        tags_json = excluded.tags_json,
        answer_hints_json = excluded.answer_hints_json,
        status = excluded.status,
        warning_message = excluded.warning_message,
        updated_at = excluded.updated_at
    `).run(
      record.id,
      record.rawMessageId,
      record.openKfId,
      record.externalUserId,
      record.sourceType,
      record.title,
      record.summary,
      record.content,
      JSON.stringify(record.keywords),
      JSON.stringify(record.tags),
      JSON.stringify(record.answerHints),
      record.status,
      record.warningMessage,
      record.createdAt,
      record.updatedAt
    );

    db.prepare("DELETE FROM archive_entries_fts WHERE archive_entry_id = ?").run(record.id);
    db.prepare(`
      INSERT INTO archive_entries_fts (archive_entry_id, title, summary, content, keywords, tags)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.title,
      record.summary ?? "",
      record.content,
      record.keywords.join(" "),
      record.tags.join(" ")
    );
  },

  getArchiveEntryById(id: string): (ArchiveEntryRecord & { answerHints: string[] }) | null {
    const row = db.prepare("SELECT * FROM archive_entries WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id as string,
      rawMessageId: row.raw_message_id as string,
      openKfId: row.open_kf_id as string,
      externalUserId: (row.external_user_id as string | null) ?? null,
      sourceType: row.source_type as ArchiveEntryRecord["sourceType"],
      title: row.title as string,
      summary: (row.summary as string | null) ?? null,
      content: row.content as string,
      keywords: safeJsonParse<string[]>(row.keywords_json as string, []),
      tags: safeJsonParse<string[]>(row.tags_json as string, []),
      status: row.status as ArchiveEntryRecord["status"],
      warningMessage: (row.warning_message as string | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      answerHints: safeJsonParse<string[]>(row.answer_hints_json as string, [])
    };
  },

  listArchiveEntries(limit = 50): Array<ArchiveEntryRecord & { answerHints: string[] }> {
    const rows = db.prepare("SELECT * FROM archive_entries ORDER BY created_at DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row.id as string,
      rawMessageId: row.raw_message_id as string,
      openKfId: row.open_kf_id as string,
      externalUserId: (row.external_user_id as string | null) ?? null,
      sourceType: row.source_type as ArchiveEntryRecord["sourceType"],
      title: row.title as string,
      summary: (row.summary as string | null) ?? null,
      content: row.content as string,
      keywords: safeJsonParse<string[]>(row.keywords_json as string, []),
      tags: safeJsonParse<string[]>(row.tags_json as string, []),
      status: row.status as ArchiveEntryRecord["status"],
      warningMessage: (row.warning_message as string | null) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      answerHints: safeJsonParse<string[]>(row.answer_hints_json as string, [])
    }));
  },

  createAsset(record: AssetRecord): void {
    db.prepare(`
      INSERT INTO assets (
        id, archive_entry_id, raw_message_id, kind, file_name, mime_type, size_bytes,
        storage_path, extracted_text, sha256, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.archiveEntryId,
      record.rawMessageId,
      record.kind,
      record.fileName,
      record.mimeType,
      record.sizeBytes,
      record.storagePath,
      record.extractedText,
      record.sha256,
      JSON.stringify(record.metadata),
      record.createdAt
    );
  },

  listAssetsByArchiveEntryId(archiveEntryId: string): AssetRecord[] {
    const rows = db.prepare("SELECT * FROM assets WHERE archive_entry_id = ? ORDER BY created_at ASC").all(archiveEntryId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row.id as string,
      archiveEntryId: (row.archive_entry_id as string | null) ?? null,
      rawMessageId: row.raw_message_id as string,
      kind: row.kind as string,
      fileName: (row.file_name as string | null) ?? null,
      mimeType: (row.mime_type as string | null) ?? null,
      sizeBytes: (row.size_bytes as number | null) ?? null,
      storagePath: row.storage_path as string,
      extractedText: (row.extracted_text as string | null) ?? null,
      sha256: (row.sha256 as string | null) ?? null,
      metadata: safeJsonParse(row.metadata_json as string, null),
      createdAt: row.created_at as string
    }));
  },

  replaceTodos(archiveEntryId: string, todos: TodoRecord[]): void {
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM todo_items WHERE archive_entry_id = ?").run(archiveEntryId);
      const statement = db.prepare(`
        INSERT INTO todo_items (
          id, archive_entry_id, title, due_at, assignee, evidence, confidence, status,
          needs_review, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const todo of todos) {
        statement.run(
          todo.id,
          todo.archiveEntryId,
          todo.title,
          todo.dueAt,
          todo.assignee,
          todo.evidence,
          todo.confidence,
          todo.status,
          todo.needsReview ? 1 : 0,
          todo.createdAt,
          todo.updatedAt
        );
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  },

  listTodos(): TodoRecord[] {
    const rows = db.prepare("SELECT * FROM todo_items ORDER BY created_at DESC").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row.id as string,
      archiveEntryId: row.archive_entry_id as string,
      title: row.title as string,
      dueAt: (row.due_at as string | null) ?? null,
      assignee: (row.assignee as string | null) ?? null,
      evidence: (row.evidence as string | null) ?? null,
      confidence: row.confidence as number,
      status: row.status as TodoRecord["status"],
      needsReview: Boolean(row.needs_review),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string
    }));
  },

  updateTodoStatus(todoId: string, status: TodoRecord["status"]): void {
    db.prepare("UPDATE todo_items SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), todoId);
  },

  upsertEmbedding(archiveEntryId: string, vector: number[]): void {
    db.prepare(`
      INSERT INTO entry_embeddings (archive_entry_id, vector_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(archive_entry_id) DO UPDATE SET
        vector_json = excluded.vector_json,
        updated_at = excluded.updated_at
    `).run(archiveEntryId, JSON.stringify(vector), nowIso());
  },

  getAllEmbeddings(): Array<{ archiveEntryId: string; vector: number[] }> {
    const rows = db.prepare("SELECT archive_entry_id, vector_json FROM entry_embeddings").all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      archiveEntryId: row.archive_entry_id as string,
      vector: safeJsonParse<number[]>(row.vector_json as string, [])
    }));
  },

  searchArchiveLexical(query: string, limit = 20): SearchResultItem[] {
    const rows = db.prepare(`
      SELECT
        entry.id,
        entry.title,
        entry.summary,
        entry.source_type,
        entry.created_at,
        entry.keywords_json,
        entry.tags_json,
        entry.warning_message,
        bm25(archive_entries_fts) AS score
      FROM archive_entries_fts
      JOIN archive_entries entry ON entry.id = archive_entries_fts.archive_entry_id
      WHERE archive_entries_fts MATCH ?
      ORDER BY score
      LIMIT ?
    `).all(query, limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      summary: (row.summary as string | null) ?? null,
      sourceType: row.source_type as string,
      createdAt: row.created_at as string,
      score: typeof row.score === "number" ? row.score : 0,
      keywords: safeJsonParse<string[]>(row.keywords_json as string, []),
      tags: safeJsonParse<string[]>(row.tags_json as string, []),
      warningMessage: (row.warning_message as string | null) ?? null
    }));
  },

  searchArchiveByLike(query: string, limit = 20): SearchResultItem[] {
    const keyword = `%${query}%`;
    const rows = db.prepare(`
      SELECT
        id,
        title,
        summary,
        source_type,
        created_at,
        keywords_json,
        tags_json,
        warning_message
      FROM archive_entries
      WHERE title LIKE ?
        OR summary LIKE ?
        OR content LIKE ?
        OR keywords_json LIKE ?
        OR tags_json LIKE ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(keyword, keyword, keyword, keyword, keyword, limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row.id as string,
      title: row.title as string,
      summary: (row.summary as string | null) ?? null,
      sourceType: row.source_type as string,
      createdAt: row.created_at as string,
      score: 0.6,
      keywords: safeJsonParse<string[]>(row.keywords_json as string, []),
      tags: safeJsonParse<string[]>(row.tags_json as string, []),
      warningMessage: (row.warning_message as string | null) ?? null
    }));
  }
};
