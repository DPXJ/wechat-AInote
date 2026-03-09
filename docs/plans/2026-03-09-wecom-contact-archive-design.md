# WeCom Contact Archive Route Design

## Goal

Replace the current WeCom Customer Service conversation entrypoint with a Cubox-style flow:

1. The assistant is added as a persistent WeCom-related contact in the user's WeChat contact list.
2. The user forwards messages, links, files, and media directly to that contact.
3. A chat-archive pipeline fetches or decrypts those messages and pushes them into the existing archive backend.
4. The existing AI title, summary, tag, todo, and search layers continue to operate without major rewrites.

## Constraints

- The current customer-service route has already proven that callback ingestion works, but its session model does not match the required "directly forward to a contact" UX.
- The backend should be reused as much as possible.
- The import route must be secure because the service is internet-facing.
- Attachment handling needs a staged approach because chat archive binaries may arrive later than message metadata.

## MVP architecture

- Keep the current SQLite, storage, archive analysis, search, and todo subsystems.
- Add a new internal ingestion route: `POST /api/wecom/contact-archive/import`
- Protect it with `WECOM_ARCHIVE_IMPORT_TOKEN`.
- Accept decrypted chat-archive messages plus optional inline attachment binaries encoded as base64.
- Import metadata-only file/image/video/voice messages as warning entries if the binary has not been fetched yet.

## Future work

- Add a dedicated chat-archive worker that calls the official archive SDK, decrypts message payloads, downloads binary attachments by `sdkfileid`, and pushes normalized messages to the import endpoint.
- Add source-specific UI labels for `wecom-contact-archive` vs `wecom-customer-service`.
- Replace the customer-service-first dashboard copy with contact-archive-first copy after the new ingestion route is proven in production.
