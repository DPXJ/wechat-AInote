import { appConfig } from "../config.js";
import { normalizeWhitespace } from "../utils.js";

interface AccessTokenResponse {
  errcode: number;
  errmsg: string;
  access_token?: string;
  expires_in?: number;
}

interface SyncMessageResponse {
  errcode: number;
  errmsg: string;
  next_cursor?: string;
  has_more?: number;
  msg_list?: Array<Record<string, unknown>>;
}

export interface NormalizedWecomMessage {
  msgId: string;
  openKfId: string;
  externalUserId: string | null;
  msgType: string;
  sendTime: number;
  origin: number | null;
  raw: Record<string, unknown>;
  textContent: string;
  mediaId: string | null;
  fileName: string | null;
}

export class WecomService {
  private accessTokenCache: { token: string; expiresAt: number } | null = null;

  private async getAccessToken(): Promise<string> {
    if (!appConfig.wecomCorpId || !appConfig.wecomAgentSecret) {
      throw new Error("Missing WECOM_CORP_ID or WECOM_AGENT_SECRET.");
    }

    const now = Date.now();
    if (this.accessTokenCache && this.accessTokenCache.expiresAt > now) {
      return this.accessTokenCache.token;
    }

    const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/gettoken");
    url.searchParams.set("corpid", appConfig.wecomCorpId);
    url.searchParams.set("corpsecret", appConfig.wecomAgentSecret);

    const response = await fetch(url);
    const payload = (await response.json()) as AccessTokenResponse;
    if (payload.errcode !== 0 || !payload.access_token) {
      throw new Error(`Failed to fetch access token: ${payload.errmsg}`);
    }

    this.accessTokenCache = {
      token: payload.access_token,
      expiresAt: now + Math.max((payload.expires_in ?? 7200) - 60, 60) * 1000
    };

    return payload.access_token;
  }

  private buildTextContent(message: Record<string, unknown>): string {
    const msgType =
      typeof message.msgtype === "string"
        ? String(message.msgtype)
        : typeof message.event === "object" && message.event !== null
          ? "event"
          : "unknown";
    if (msgType === "text") {
      return normalizeWhitespace(String((message.text as { content?: string } | undefined)?.content ?? ""));
    }
    if (msgType === "link") {
      const link = message.link as { title?: string; desc?: string; url?: string } | undefined;
      return normalizeWhitespace([link?.title, link?.desc, link?.url].filter(Boolean).join(" "));
    }
    if (msgType === "location") {
      const location = message.location as { name?: string; address?: string } | undefined;
      return normalizeWhitespace([location?.name, location?.address].filter(Boolean).join(" "));
    }
    if (msgType === "merged_msg") {
      return normalizeWhitespace(JSON.stringify((message.merged_msg as { item?: unknown[] } | undefined)?.item ?? []));
    }
    return "";
  }

  normalizeMessage(message: Record<string, unknown>): NormalizedWecomMessage {
    const msgType =
      typeof message.msgtype === "string"
        ? String(message.msgtype)
        : typeof message.event === "object" && message.event !== null
          ? "event"
          : "unknown";
    const mediaContainer = message[msgType] as { media_id?: string; filename?: string; name?: string } | undefined;
    return {
      msgId: String(
        message.msgid ??
          ((message.event as { event_id?: string } | undefined)?.event_id ?? `${msgType}-${message.send_time ?? Date.now()}`)
      ),
      openKfId: String(message.open_kfid),
      externalUserId: typeof message.external_userid === "string" ? message.external_userid : null,
      msgType,
      sendTime: Number(message.send_time ?? Math.floor(Date.now() / 1000)),
      origin: typeof message.origin === "number" ? message.origin : null,
      raw: message,
      textContent: this.buildTextContent(message),
      mediaId: mediaContainer?.media_id ?? null,
      fileName: mediaContainer?.filename ?? mediaContainer?.name ?? null
    };
  }

  async syncMessages(openKfId: string, cursor?: string, token?: string): Promise<{
    nextCursor: string | null;
    hasMore: boolean;
    messages: NormalizedWecomMessage[];
  }> {
    const accessToken = await this.getAccessToken();
    const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/kf/sync_msg");
    url.searchParams.set("access_token", accessToken);

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cursor,
        token,
        limit: appConfig.wecomSyncPageSize,
        open_kfid: openKfId,
        voice_format: 0
      })
    });

    const payload = (await response.json()) as SyncMessageResponse;
    if (payload.errcode !== 0) {
      throw new Error(`WeCom sync failed for ${openKfId}: ${payload.errmsg}`);
    }

    return {
      nextCursor: payload.next_cursor ?? null,
      hasMore: payload.has_more === 1,
      messages: (payload.msg_list ?? []).map((item) => this.normalizeMessage(item))
    };
  }

  async downloadMedia(mediaId: string): Promise<{
    buffer: Buffer;
    contentType: string | null;
    contentDisposition: string | null;
    sizeBytes: number;
  }> {
    const accessToken = await this.getAccessToken();
    const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/media/get");
    url.searchParams.set("access_token", accessToken);
    url.searchParams.set("media_id", mediaId);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Media download failed with status ${response.status}.`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      buffer,
      contentType: response.headers.get("content-type"),
      contentDisposition: response.headers.get("content-disposition"),
      sizeBytes: buffer.byteLength
    };
  }

  async sendTextMessage(input: {
    externalUserId: string;
    openKfId: string;
    content: string;
    msgId?: string;
  }): Promise<void> {
    const accessToken = await this.getAccessToken();
    const url = new URL("https://qyapi.weixin.qq.com/cgi-bin/kf/send_msg");
    url.searchParams.set("access_token", accessToken);

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        touser: input.externalUserId,
        open_kfid: input.openKfId,
        msgid: input.msgId,
        msgtype: "text",
        text: {
          content: input.content
        }
      })
    });

    const payload = (await response.json()) as { errcode?: number; errmsg?: string };
    if (payload.errcode !== 0) {
      throw new Error(`WeCom send_msg failed: ${payload.errmsg ?? "unknown error"}`);
    }
  }
}

export const wecomService = new WecomService();
