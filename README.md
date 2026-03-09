# WeChat Knowledge Assistant

An internal-first knowledge capture tool that is transitioning from WeCom Customer Service ingestion to a Cubox-style WeCom contact + chat-archive ingestion route.

## Quick start

1. Copy `.env.example` to `.env` and fill in the WeCom and OpenAI values.
2. Install dependencies with `npm install`.
3. Start the app with `npm run dev`.
4. Open `http://localhost:3000`.

## Current ingestion routes

### Legacy route: WeCom Customer Service

Configure the WeCom customer service callback URL to:

- `GET/POST {APP_URL}/api/wecom/callback`

Required `.env` values:

- `WECOM_CORP_ID`
- `WECOM_AGENT_SECRET`
- `WECOM_CALLBACK_TOKEN`
- `WECOM_CALLBACK_AES_KEY`

Behavior:

- `GET /api/wecom/callback` handles URL verification.
- `POST /api/wecom/callback` verifies and decrypts the callback payload, triggers realtime `sync_msg`, archives new messages, and sends an automatic text reply after successful ingestion.
- If WeCom returns an oversize fallback message, the auto reply redirects the user to `{APP_URL}/upload` for manual upload.

### New primary route: WeCom contact + chat archive

This route is intended to support a Cubox-style workflow where the assistant is added as a contact and users forward material directly to that contact.

Required `.env` values:

- `WECOM_ARCHIVE_IMPORT_TOKEN`
- `WECOM_ARCHIVE_INBOX_DIR`
- `WECOM_ARCHIVE_PROCESSED_DIR`
- `WECOM_ARCHIVE_FAILED_DIR`

Internal import endpoint:

- `POST {APP_URL}/api/wecom/contact-archive/import`

Headers:

- `Authorization: Bearer {WECOM_ARCHIVE_IMPORT_TOKEN}`
  or
- `x-import-token: {WECOM_ARCHIVE_IMPORT_TOKEN}`

Request body:

```json
{
  "messages": [
    {
      "msgid": "archive-msg-001",
      "msgtime": 1773036441,
      "msgtype": "text",
      "from": "zhangsan",
      "tolist": ["external-user-001"],
      "external_userid": "external-user-001",
      "contact_account_id": "contact:archive-assistant",
      "text": { "content": "公司的宣传手册发你了" }
    }
  ]
}
```

Optional inline attachment payload:

```json
{
  "msgid": "archive-msg-002",
  "msgtime": 1773036442,
  "msgtype": "file",
  "external_userid": "external-user-001",
  "attachment": {
    "fileName": "brand-book.pdf",
    "mimeType": "application/pdf",
    "base64": "<base64-file-content>"
  },
  "file": {
    "filename": "brand-book.pdf",
    "sdkfileid": "sdkfileid-123"
  }
}
```

Optional local-file attachment payload:

```json
{
  "messages": [
    {
      "msgid": "archive-msg-003",
      "msgtime": 1773036443,
      "msgtype": "file",
      "external_userid": "external-user-001",
      "attachment": {
        "fileName": "brand-book.pdf",
        "mimeType": "application/pdf",
        "filePath": "./attachments/brand-book.pdf"
      },
      "file": {
        "filename": "brand-book.pdf",
        "sdkfileid": "sdkfileid-456"
      }
    }
  ],
  "attachmentsRoot": "./"
}
```

Behavior:

- Archives decrypted chat-archive messages into the same SQLite knowledge base.
- Stores inline attachment binaries under local storage when provided.
- Supports attachment files referenced by local path, which is useful when an external chat-archive SDK writes JSON plus binaries to disk.
- Falls back to metadata-only import when only `sdkfileid` is available, and marks the entry as a warning so a later downloader can fetch the binary.

### Contact archive inbox worker

If an external exporter or SDK drops decrypted chat-archive payloads into a local directory, run:

```bash
npm run archive:inbox
```

The worker:

- Reads every `.json` file under `WECOM_ARCHIVE_INBOX_DIR`
- Imports messages into the same archive pipeline
- Moves successfully imported payload files to `WECOM_ARCHIVE_PROCESSED_DIR`
- Moves failed payload files to `WECOM_ARCHIVE_FAILED_DIR`

Accepted JSON formats:

- A plain array of messages
- An object with `{ "messages": [...] }`
- An object with `{ "messages": [...], "attachmentsRoot": "./attachments" }`

This lets the current backend stay stable while the official WeCom chat-archive retriever is built or integrated later.

## WeCom callback setup
The callback route remains available for the legacy customer-service-based flow.

## Current scope

- Supports WeCom Customer Service callback URL verification and realtime message sync
- Supports internal import of WeCom contact/chat-archive messages
- Supports batch import from a local contact-archive inbox directory
- Stores data in SQLite and files on local disk
- Extracts text from `txt`, `md`, `pdf`, `docx`, `xlsx`, `csv`, `pptx`
- Generates AI title, summary, keywords, tags, and todo candidates
- Provides a searchable web console and mobile-friendly H5
