# WeChat Customer Service Knowledge Assistant Design

## Goal

Build an internal-first assistant that behaves like a WeChat forwarding inbox. A user forwards content from WeChat to a dedicated assistant account, and the system automatically stores the original material, extracts useful information, generates a concise knowledge card, and creates todo candidates when appropriate. The system must optimize for low interaction cost. The default path is "forward once, let AI do the rest". Human correction exists, but only as a safety net. The product should also function as a searchable knowledge base so that a user can later ask for "the company brochure" or "the pricing deck from last week" and immediately get both an answer and the matching source items.

The chosen entry point is WeCom Customer Service, not a classic public service account. This is because the customer service message pipeline supports file messages in addition to text, links, images, audio, and video. That makes it a much better fit for Cubox-like forwarding workflows.

## Architecture

Phase one uses a single TypeScript server instead of microservices. The server exposes both the management console and JSON APIs. Data is stored in SQLite for local-first internal deployment and fast setup. Binary assets are stored on local disk behind a storage abstraction so the implementation can later move to S3-compatible object storage without rewriting the archive pipeline. Search combines SQLite FTS for lexical retrieval and embedding-based re-ranking in application code. This is good enough for an internal-first tool while keeping operational complexity low.

The server has five core modules: WeCom sync, archive ingestion, asset extraction, AI enrichment, and retrieval. WeCom sync pulls messages from `kf/sync_msg` per configured `open_kfid`. Archive ingestion saves raw messages, normalizes them into internal archive entries, downloads media by `media_id`, and hands assets to the extraction pipeline. AI enrichment writes title, summary, keywords, tags, and todo candidates. Retrieval serves both search results and answer-oriented summaries with citations back to the original stored item.

## Data Model

The system stores four distinct layers. First, `raw_messages` preserve the original WeCom payload for traceability and replay. Second, `assets` represent stored files and media. Each asset stores path, MIME type, file size, hash, extracted text, and parser metadata. Third, `archive_entries` are the user-facing knowledge cards. These are the objects shown in search, lists, and detail pages. Each entry stores the normalized title, summary, content, tags, keywords, confidence flags, source metadata, and the linked primary asset if one exists. Fourth, `todo_items` capture action candidates inferred from the content. Todo rows preserve confidence scores and evidence snippets so users can quickly judge why an item was created.

## Workflow

The operator opens the console, configures the WeCom account IDs, and triggers a sync. The sync module requests an access token, pulls paginated customer service messages, and stores any unseen message. If a message contains `media_id`, the system downloads the binary immediately because the remote media identifier is short-lived. The archive pipeline then extracts text from supported formats, builds a canonical text body, asks AI to enrich it, and writes the result into the knowledge base. Messages that look like oversize failures or unsupported formats are marked with a warning state so the UI can instruct the user to use a fallback upload flow later.
