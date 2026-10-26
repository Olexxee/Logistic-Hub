import { createHmac, timingSafeEqual } from "node:crypto";
import { ServiceUnavailableError, AppError } from "../../shared/http/app-error.js";

export function createPaystackProvider({ secretKey = "", fetchImpl = globalThis.fetch } = {}) {
  function configured() { return typeof secretKey === "string" && secretKey.trim().length > 0; }
  async function request(path, { method = "GET", body } = {}) {
    if (!configured()) throw new ServiceUnavailableError("Paystack is not configured.", "PAYSTACK_NOT_CONFIGURED");
    const response = await fetchImpl(`https://api.paystack.co${path}`, {
      method,
      headers: { Authorization: `Bearer ${secretKey}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status !== true) {
      throw new AppError("Paystack request failed.", { statusCode: 502, code: "PAYSTACK_REQUEST_FAILED" });
    }
    return payload.data;
  }
  return {
    verifyWebhookSignature(rawBody, signature) {
      if (!configured() || !Buffer.isBuffer(rawBody) || typeof signature !== "string") return false;
      const expected = createHmac("sha512", secretKey).update(rawBody).digest();
      let received;
      try { received = Buffer.from(signature, "hex"); } catch { return false; }
      return received.length === expected.length && timingSafeEqual(received, expected);
    },
    initializeTransaction(input) { return request("/transaction/initialize", { method: "POST", body: input }); },
    verifyTransaction(reference) { return request(`/transaction/verify/${encodeURIComponent(reference)}`); },
  };
}
