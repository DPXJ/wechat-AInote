import fs from "node:fs";
import Fastify from "fastify";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { appConfig } from "./config.js";
import { repositories } from "./repositories.js";
import { archiveService } from "./services/archive.js";
import { runSync } from "./services/sync.js";
import { searchArchive } from "./services/search.js";
import { renderDashboardHtml, renderUploadHtml } from "./ui.js";
import {
  decryptWecomPayload,
  parseInnerXml,
  parseOuterXml,
  verifySignature
} from "./services/wecom-callback.js";

fs.mkdirSync(appConfig.storageDir, { recursive: true });

function getMultipartFieldValue(field: unknown): string | null {
  if (!field) {
    return null;
  }
  if (Array.isArray(field)) {
    return getMultipartFieldValue(field[0]);
  }
  if (typeof field === "object" && field !== null && "value" in field && typeof field.value === "string") {
    return field.value;
  }
  return null;
}

export function buildServer() {
  const server = Fastify({ logger: true });

  server.addContentTypeParser(["application/xml", "text/xml"], { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  server.register(fastifyMultipart, {
    limits: {
      files: 1,
      fileSize: 1024 * 1024 * 512
    }
  });

  server.register(fastifyStatic, {
    root: appConfig.storageDir,
    prefix: "/stored/"
  });

  server.get("/", async (_request, reply) => {
    reply.type("text/html; charset=utf-8").send(renderDashboardHtml());
  });

  server.get("/upload", async (_request, reply) => {
    reply.type("text/html; charset=utf-8").send(renderUploadHtml());
  });

  server.get("/api/archive", async () => {
    return { items: repositories.listArchiveEntries(40) };
  });

  server.get("/api/archive/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const entry = repositories.getArchiveEntryById(id);
    if (!entry) {
      reply.code(404);
      return { error: "Entry not found" };
    }
    return { entry, assets: repositories.listAssetsByArchiveEntryId(id) };
  });

  server.get("/api/search", async (request) => {
    const query = ((request.query as { q?: string }).q ?? "").trim();
    if (!query) {
      return {
        answer: "",
        results: repositories.listArchiveEntries(20).map((entry) => ({
          id: entry.id,
          title: entry.title,
          summary: entry.summary,
          sourceType: entry.sourceType,
          createdAt: entry.createdAt,
          score: 0,
          keywords: entry.keywords,
          tags: entry.tags,
          warningMessage: entry.warningMessage
        }))
      };
    }
    return searchArchive(query);
  });

  server.post("/api/sync", async (_request, reply) => {
    if (appConfig.wecomOpenKfIds.length === 0) {
      reply.code(400);
      return { error: "Configure WECOM_OPEN_KF_IDS in .env before syncing." };
    }
    return runSync({ openKfIds: appConfig.wecomOpenKfIds });
  });

  server.get("/api/wecom/callback", async (request, reply) => {
    const query = request.query as {
      msg_signature?: string;
      timestamp?: string;
      nonce?: string;
      echostr?: string;
    };

    if (!query.msg_signature || !query.timestamp || !query.nonce || !query.echostr) {
      reply.code(400);
      return { error: "Missing callback verification query params." };
    }

    if (!verifySignature(query.msg_signature, query.timestamp, query.nonce, query.echostr)) {
      reply.code(401);
      return { error: "Invalid callback signature." };
    }

    const { message } = decryptWecomPayload(query.echostr);
    reply.type("text/plain; charset=utf-8").send(message);
  });

  server.post("/api/wecom/callback", async (request, reply) => {
    const query = request.query as {
      msg_signature?: string;
      timestamp?: string;
      nonce?: string;
    };
    const body = typeof request.body === "string" ? request.body : "";
    const outer = parseOuterXml(body);

    if (!query.msg_signature || !query.timestamp || !query.nonce || !outer.encrypt) {
      reply.code(400);
      return { error: "Missing callback signature or encrypted payload." };
    }

    if (!verifySignature(query.msg_signature, query.timestamp, query.nonce, outer.encrypt)) {
      reply.code(401);
      return { error: "Invalid callback signature." };
    }

    const { message } = decryptWecomPayload(outer.encrypt);
    const inner = parseInnerXml(message);

    if (inner.Event === "kf_msg_or_event" && inner.OpenKfId && inner.Token) {
      void runSync({
        openKfIds: [inner.OpenKfId],
        token: inner.Token,
        autoReply: true
      }).catch((error) => {
        server.log.error({ err: error, openKfId: inner.OpenKfId }, "WeCom callback sync failed");
      });
    }

    reply.type("text/plain; charset=utf-8").send("success");
  });

  server.post("/api/uploads", async (request, reply) => {
    const file = await request.file();
    if (!file) {
      reply.code(400);
      return { error: "Missing file" };
    }

    const buffer = await file.toBuffer();
    const note = getMultipartFieldValue(file.fields.note);
    await archiveService.ingestManualUpload({
      fileName: file.filename,
      buffer,
      note
    });
    return { ok: true };
  });

  server.get("/api/todos", async () => {
    return { items: repositories.listTodos() };
  });

  server.patch("/api/todos/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const status = (request.body as { status?: "open" | "done" | "dismissed" }).status;
    if (!status) {
      reply.code(400);
      return { error: "Missing status" };
    }
    repositories.updateTodoStatus(id, status);
    return { ok: true };
  });

  server.setErrorHandler((error, _request, reply) => {
    server.log.error(error);
    reply.code(500).send({ error: error.message });
  });

  return server;
}

export async function startServer() {
  const server = buildServer();
  await server.listen({ port: appConfig.port, host: "0.0.0.0" });
  return server;
}
