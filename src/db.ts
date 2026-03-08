import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { appConfig } from "./config.js";

fs.mkdirSync(path.dirname(appConfig.sqlitePath), { recursive: true });

export const db = new DatabaseSync(appConfig.sqlitePath);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS raw_messages (
    id TEXT PRIMARY KEY,
    msg_id TEXT NOT NULL UNIQUE,
    open_kf_id TEXT NOT NULL,
    external_user_id TEXT,
    msg_type TEXT NOT NULL,
    send_time INTEGER NOT NULL,
    source_payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS archive_entries (
    id TEXT PRIMARY KEY,
    raw_message_id TEXT NOT NULL UNIQUE,
    open_kf_id TEXT NOT NULL,
    external_user_id TEXT,
    source_type TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    content TEXT NOT NULL,
    keywords_json TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    answer_hints_json TEXT NOT NULL,
    status TEXT NOT NULL,
    warning_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (raw_message_id) REFERENCES raw_messages(id)
  );

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    archive_entry_id TEXT,
    raw_message_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    file_name TEXT,
    mime_type TEXT,
    size_bytes INTEGER,
    storage_path TEXT NOT NULL,
    extracted_text TEXT,
    sha256 TEXT,
    metadata_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (archive_entry_id) REFERENCES archive_entries(id),
    FOREIGN KEY (raw_message_id) REFERENCES raw_messages(id)
  );

  CREATE TABLE IF NOT EXISTS todo_items (
    id TEXT PRIMARY KEY,
    archive_entry_id TEXT NOT NULL,
    title TEXT NOT NULL,
    due_at TEXT,
    assignee TEXT,
    evidence TEXT,
    confidence REAL NOT NULL,
    status TEXT NOT NULL,
    needs_review INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (archive_entry_id) REFERENCES archive_entries(id)
  );

  CREATE TABLE IF NOT EXISTS entry_embeddings (
    archive_entry_id TEXT PRIMARY KEY,
    vector_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (archive_entry_id) REFERENCES archive_entries(id)
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS archive_entries_fts USING fts5(
    archive_entry_id UNINDEXED,
    title,
    summary,
    content,
    keywords,
    tags
  );
`);
