import path from "node:path";
import { config as loadEnv } from "dotenv";
import { z } from "zod";

loadEnv();

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().default("http://localhost:3000"),
  SQLITE_PATH: z.string().default("./data/app.db"),
  STORAGE_DIR: z.string().default("./data/storage"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  WECOM_CORP_ID: z.string().optional(),
  WECOM_AGENT_SECRET: z.string().optional(),
  WECOM_OPEN_KF_IDS: z.string().default(""),
  WECOM_SYNC_PAGE_SIZE: z.coerce.number().default(100),
  WECOM_CALLBACK_TOKEN: z.string().optional(),
  WECOM_CALLBACK_AES_KEY: z.string().optional(),
  WECOM_ARCHIVE_IMPORT_TOKEN: z.string().optional(),
  WECOM_ARCHIVE_INBOX_DIR: z.string().default("./data/wecom-contact-archive/inbox"),
  WECOM_ARCHIVE_PROCESSED_DIR: z.string().default("./data/wecom-contact-archive/processed"),
  WECOM_ARCHIVE_FAILED_DIR: z.string().default("./data/wecom-contact-archive/failed")
});

const parsed = schema.parse(process.env);

export const appConfig = {
  port: parsed.PORT,
  appUrl: parsed.APP_URL,
  sqlitePath: path.resolve(parsed.SQLITE_PATH),
  storageDir: path.resolve(parsed.STORAGE_DIR),
  openAiApiKey: parsed.OPENAI_API_KEY,
  openAiModel: parsed.OPENAI_MODEL,
  openAiEmbeddingModel: parsed.OPENAI_EMBEDDING_MODEL,
  wecomCorpId: parsed.WECOM_CORP_ID,
  wecomAgentSecret: parsed.WECOM_AGENT_SECRET,
  wecomOpenKfIds: parsed.WECOM_OPEN_KF_IDS.split(",").map((value) => value.trim()).filter(Boolean),
  wecomSyncPageSize: parsed.WECOM_SYNC_PAGE_SIZE,
  wecomCallbackToken: parsed.WECOM_CALLBACK_TOKEN,
  wecomCallbackAesKey: parsed.WECOM_CALLBACK_AES_KEY,
  wecomArchiveImportToken: parsed.WECOM_ARCHIVE_IMPORT_TOKEN,
  wecomArchiveInboxDir: path.resolve(parsed.WECOM_ARCHIVE_INBOX_DIR),
  wecomArchiveProcessedDir: path.resolve(parsed.WECOM_ARCHIVE_PROCESSED_DIR),
  wecomArchiveFailedDir: path.resolve(parsed.WECOM_ARCHIVE_FAILED_DIR)
};
