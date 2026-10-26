import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export function createOpaqueToken() {
  return randomBytes(32).toString("hex");
}

export function hashOpaqueToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64, SCRYPT_OPTIONS);
  return `scrypt$${salt}$${Buffer.from(derivedKey).toString("hex")}`;
}

export async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== "string") return false;
  const [scheme, salt, expectedHex] = storedHash.split("$");
  if (scheme !== "scrypt" || !salt || !expectedHex || !/^[a-f0-9]{128}$/i.test(expectedHex)) return false;

  const derivedKey = Buffer.from(await scrypt(password, salt, 64, SCRYPT_OPTIONS));
  const expected = Buffer.from(expectedHex, "hex");
  return expected.length === derivedKey.length && timingSafeEqual(expected, derivedKey);
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function signAccessToken({ userId, role, secret, sessionId, now = Date.now() }) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) {
    const error = new Error("Authentication is not configured.");
    error.code = "AUTH_NOT_CONFIGURED";
    throw error;
  }

  const issuedAt = Math.floor(now / 1000);
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson({
    sub: userId,
    role,
    ...(sessionId ? { sid: sessionId } : {}),
    iat: issuedAt,
    exp: issuedAt + ACCESS_TOKEN_TTL_SECONDS,
  });
  const input = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(input).digest("base64url");
  return { token: `${input}.${signature}`, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
}

export function verifyAccessToken(token, secret, now = Date.now()) {
  if (typeof token !== "string" || typeof secret !== "string" || Buffer.byteLength(secret) < 32) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  let actual;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const decodedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
    const decodedPayload = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (decodedHeader.alg !== "HS256" || decodedHeader.typ !== "JWT") return null;
    if (typeof decodedPayload.sub !== "string" || typeof decodedPayload.role !== "string") return null;
    if (!Number.isInteger(decodedPayload.exp) || decodedPayload.exp <= Math.floor(now / 1000)) return null;
    return decodedPayload;
  } catch {
    return null;
  }
}
