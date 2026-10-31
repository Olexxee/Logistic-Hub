import { createSign } from "node:crypto";
import { env } from "../../config/env.js";
import { ServiceUnavailableError } from "../../shared/http/app-error.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const STORAGE_API = "https://storage.googleapis.com/storage/v1";

export function createFirebaseStorage({ fetchImpl = fetch, clock = () => Date.now() } = {}) {
  let cachedToken = null;

  function credentials() {
    if (!env.FIREBASE_SERVICE_ACCOUNT_BASE64 || !env.FIREBASE_STORAGE_BUCKET) {
      throw new ServiceUnavailableError("Evidence storage is not configured.", "MEDIA_STORAGE_NOT_CONFIGURED");
    }
    try {
      return JSON.parse(Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8"));
    } catch {
      throw new ServiceUnavailableError("Evidence storage credentials are invalid.", "MEDIA_STORAGE_CONFIGURATION_INVALID");
    }
  }

  async function accessToken() {
    if (cachedToken && cachedToken.expiresAt > clock() + 60_000) return cachedToken.value;
    const account = credentials();
    const issuedAt = Math.floor(clock() / 1000);
    const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = [
      encode({ alg: "RS256", typ: "JWT" }),
      encode({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/devstorage.read_write",
        aud: TOKEN_URL,
        iat: issuedAt,
        exp: issuedAt + 3600,
      }),
    ].join(".");
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    const assertion = `${unsigned}.${signer.sign(account.private_key, "base64url")}`;
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    if (!response.ok) throw new ServiceUnavailableError("Could not authenticate with Firebase Storage.", "MEDIA_STORAGE_AUTH_FAILED");
    const payload = await response.json();
    cachedToken = { value: payload.access_token, expiresAt: clock() + Number(payload.expires_in ?? 3600) * 1000 };
    return cachedToken.value;
  }

  async function request(url, options = {}) {
    const token = await accessToken();
    const response = await fetchImpl(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...(options.headers ?? {}) },
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new ServiceUnavailableError(
        `Firebase Storage request failed with status ${response.status}.${errorText ? " " + errorText.slice(0, 200) : ""}`,
        "MEDIA_STORAGE_REQUEST_FAILED",
      );
    }
    return response;
  }

  return {
    bucket: env.FIREBASE_STORAGE_BUCKET,
    async upload({ objectPath, buffer, mimeType }) {
      const url = new URL(`${STORAGE_API}/b/${encodeURIComponent(env.FIREBASE_STORAGE_BUCKET)}/o`);
      url.searchParams.set("uploadType", "media");
      url.searchParams.set("name", objectPath);
      await request(url, { method: "POST", headers: { "Content-Type": mimeType }, body: buffer });
    },
    async download({ objectPath }) {
      const url = new URL(`${STORAGE_API}/b/${encodeURIComponent(env.FIREBASE_STORAGE_BUCKET)}/o/${encodeURIComponent(objectPath)}`);
      url.searchParams.set("alt", "media");
      const response = await request(url);
      return Buffer.from(await response.arrayBuffer());
    },
    async delete({ objectPath }) {
      const url = new URL(`${STORAGE_API}/b/${encodeURIComponent(env.FIREBASE_STORAGE_BUCKET)}/o/${encodeURIComponent(objectPath)}`);
      await request(url, { method: "DELETE" });
    },
  };
}
