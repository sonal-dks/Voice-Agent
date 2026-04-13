import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export function requirePiiEncryptionKeyHex(): Buffer {
  const hex = process.env.PII_ENCRYPTION_KEY?.trim();
  if (!hex) throw new Error("PII_ENCRYPTION_KEY is not set");
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error("PII_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }
  return key;
}

/**
 * AES-256-GCM encrypt UTF-8 plaintext; returns base64url-ish JSON blob for storage.
 */
export function encryptPiiPayload(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = {
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    c: enc.toString("base64"),
  };
  return Buffer.from(JSON.stringify(packed), "utf8").toString("base64");
}

export function decryptPiiPayload(ciphertextB64: string, key: Buffer): string {
  const outer = Buffer.from(ciphertextB64, "base64").toString("utf8");
  const packed = JSON.parse(outer) as { v: number; iv: string; tag: string; c: string };
  const iv = Buffer.from(packed.iv, "base64");
  const tag = Buffer.from(packed.tag, "base64");
  const enc = Buffer.from(packed.c, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
