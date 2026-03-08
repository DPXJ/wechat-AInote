import crypto from "node:crypto";
import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { appConfig } from "../config.js";

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: false
});

const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: false
});

function assertCallbackSecrets() {
  if (!appConfig.wecomCallbackToken || !appConfig.wecomCallbackAesKey) {
    throw new Error("Missing WECOM_CALLBACK_TOKEN or WECOM_CALLBACK_AES_KEY.");
  }
}

function getAesKey(): Buffer {
  assertCallbackSecrets();
  return Buffer.from(`${appConfig.wecomCallbackAesKey}=`, "base64");
}

function pkcs7Unpad(buffer: Buffer): Buffer {
  const pad = buffer[buffer.length - 1];
  if (pad < 1 || pad > 32) {
    return buffer;
  }
  return buffer.subarray(0, buffer.length - pad);
}

function pkcs7Pad(buffer: Buffer): Buffer {
  const blockSize = 32;
  const remainder = buffer.length % blockSize;
  const pad = remainder === 0 ? blockSize : blockSize - remainder;
  return Buffer.concat([buffer, Buffer.alloc(pad, pad)]);
}

export function buildSignature(timestamp: string, nonce: string, encrypted: string): string {
  assertCallbackSecrets();
  const payload = [appConfig.wecomCallbackToken!, timestamp, nonce, encrypted].sort().join("");
  return crypto.createHash("sha1").update(payload).digest("hex");
}

export function verifySignature(signature: string, timestamp: string, nonce: string, encrypted: string): boolean {
  return buildSignature(timestamp, nonce, encrypted) === signature;
}

export function decryptWecomPayload(encrypted: string): { message: string; receiveId: string } {
  const key = getAesKey();
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]);
  const unpadded = pkcs7Unpad(decrypted);
  const msgLength = unpadded.readUInt32BE(16);
  const msg = unpadded.subarray(20, 20 + msgLength).toString("utf8");
  const receiveId = unpadded.subarray(20 + msgLength).toString("utf8");
  return { message: msg, receiveId };
}

export function encryptWecomPayload(message: string, receiveId: string): string {
  const key = getAesKey();
  const random16 = crypto.randomBytes(16);
  const messageBuffer = Buffer.from(message, "utf8");
  const messageLength = Buffer.alloc(4);
  messageLength.writeUInt32BE(messageBuffer.length, 0);
  const receiveIdBuffer = Buffer.from(receiveId, "utf8");
  const plain = pkcs7Pad(Buffer.concat([random16, messageLength, messageBuffer, receiveIdBuffer]));

  const cipher = crypto.createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(plain), cipher.final()]).toString("base64");
}

export function parseOuterXml(xmlText: string): { encrypt?: string; toUserName?: string; agentId?: string } {
  const parsed = parser.parse(xmlText) as {
    xml?: {
      Encrypt?: string;
      ToUserName?: string;
      AgentID?: string;
    };
  };
  return {
    encrypt: parsed.xml?.Encrypt,
    toUserName: parsed.xml?.ToUserName,
    agentId: parsed.xml?.AgentID
  };
}

export function parseInnerXml(xmlText: string): Record<string, string> {
  const parsed = parser.parse(xmlText) as { xml?: Record<string, unknown> };
  const source = parsed.xml ?? {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" || typeof value === "number") {
      result[key] = String(value);
    }
  }
  return result;
}

export function buildEncryptedReplyXml(message: string, timestamp: string, nonce: string, receiveId: string): string {
  const encrypt = encryptWecomPayload(message, receiveId);
  const msgSignature = buildSignature(timestamp, nonce, encrypt);
  return builder.build({
    xml: {
      Encrypt: encrypt,
      MsgSignature: msgSignature,
      TimeStamp: timestamp,
      Nonce: nonce
    }
  });
}
