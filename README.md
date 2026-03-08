# WeChat Knowledge Assistant

An internal-first knowledge capture tool built around WeCom Customer Service.

## Quick start

1. Copy `.env.example` to `.env` and fill in the WeCom and OpenAI values.
2. Install dependencies with `npm install`.
3. Start the app with `npm run dev`.
4. Open `http://localhost:3000`.

## WeCom callback setup

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

## Current scope

- Pulls WeCom Customer Service messages by `open_kfid`
- Supports WeCom callback URL verification and realtime message sync
- Stores data in SQLite and files on local disk
- Extracts text from `txt`, `md`, `pdf`, `docx`, `xlsx`, `csv`, `pptx`
- Generates AI title, summary, keywords, tags, and todo candidates
- Provides a searchable web console and mobile-friendly H5
