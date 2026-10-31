import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../../config/env.js";

const ALGORITHM = "aes-256-gcm";

function encryptionKey(value = env.OUTBOX_ENCRYPTION_KEY) {
  if (typeof value !== "string" || !value.trim()) {
    const error = new Error("OUTBOX_ENCRYPTION_KEY is required to enqueue or process email jobs.");
    error.code = "OUTBOX_ENCRYPTION_NOT_CONFIGURED";
    throw error;
  }
  const key = Buffer.from(value.trim(), "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== value.trim().replace(/=+$/, "")) {
    const error = new Error("OUTBOX_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
    error.code = "OUTBOX_ENCRYPTION_KEY_INVALID";
    throw error;
  }
  return key;
}

export function encryptJobPayload(payload, keyValue) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(keyValue), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64")).join(".");
}

export function decryptJobPayload(value, keyValue) {
  if (typeof value !== "string") throw new TypeError("Encrypted job payload must be a string.");
  const [ivText, tagText, ciphertextText, extra] = value.split(".");
  if (!ivText || !tagText || !ciphertextText || extra !== undefined) {
    throw new Error("Encrypted job payload has an invalid format.");
  }
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(keyValue), Buffer.from(ivText, "base64"));
  decipher.setAuthTag(Buffer.from(tagText, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}
