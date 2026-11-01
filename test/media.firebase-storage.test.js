import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createFirebaseStorage } from "../src/modules/media/firebase-storage.js";

test("Firebase storage signs a server token and uses private object upload/download/delete APIs", async () => {
  const previousCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  const previousBucket = process.env.FIREBASE_STORAGE_BUCKET;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 = Buffer.from(JSON.stringify({
    project_id: "logistic-hub-test",
    client_email: "firebase-test@logistic-hub-test.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  })).toString("base64");
  process.env.FIREBASE_STORAGE_BUCKET = "logistic-hub-test.firebasestorage.app";

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === "https://oauth2.googleapis.com/token") {
      return { ok: true, json: async () => ({ access_token: "test-access-token", expires_in: 3600 }) };
    }
    if (String(url).includes("alt=media")) {
      return { ok: true, arrayBuffer: async () => Buffer.from("private evidence") };
    }
    return { ok: true };
  };

  try {
    const storage = createFirebaseStorage({ fetchImpl, clock: () => 1_800_000_000_000 });
    await storage.upload({ objectPath: "support-tickets/ticket-1/evidence.pdf", buffer: Buffer.from("%PDF-1.7"), mimeType: "application/pdf" });
    const downloaded = await storage.download({ objectPath: "support-tickets/ticket-1/evidence.pdf" });
    await storage.delete({ objectPath: "support-tickets/ticket-1/evidence.pdf" });

    assert.equal(downloaded.toString("utf8"), "private evidence");
    assert.equal(calls.filter(call => call.url === "https://oauth2.googleapis.com/token").length, 1);
    assert.ok(calls[1].url.startsWith("https://storage.googleapis.com/upload/storage/v1/b/"));
    assert.equal(calls[1].options.headers.Authorization, "Bearer test-access-token");
    assert.ok(calls[2].url.includes("/storage/v1/b/"));
    assert.ok(calls[3].url.includes("/storage/v1/b/"));
    assert.equal(storage.bucket, "logistic-hub-test.firebasestorage.app");
  } finally {
    if (previousCredentials === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    else process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 = previousCredentials;
    if (previousBucket === undefined) delete process.env.FIREBASE_STORAGE_BUCKET;
    else process.env.FIREBASE_STORAGE_BUCKET = previousBucket;
  }
});
