import { createCipheriv, randomBytes } from "crypto";

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
