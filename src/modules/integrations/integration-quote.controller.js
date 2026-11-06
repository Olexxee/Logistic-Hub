import { createIntegrationQuoteService } from "./integration-quote.service.js";
import { ValidationError } from "../../shared/http/app-error.js";

export function createIntegrationQuoteController({ prismaClient, clock } = {}) {
  const service = createIntegrationQuoteService({ prismaClient, clock });
  function requireIdempotencyKey(req) {
    const key = req.get("idempotency-key")?.trim();
    if (!key || key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
      throw new ValidationError("A valid Idempotency-Key header (8–128 characters) is required.", {
        field: "Idempotency-Key",
      });
    }
    return key;
  }
  return {
    async create(req, res) {
      const result = await service.createQuote({
        client: req.integrationClient,
        idempotencyKey: requireIdempotencyKey(req),
        input: req.body,
      });
      return res.status(result.statusCode).json({
        success: true, data: { ...result.body, replay: result.replay === true },
      });
    },
    async get(req, res) {
      const quoteSession = await service.getQuote({
        clientId: req.integrationClient.id,
        quoteSessionId: req.params.quoteSessionId,
      });
      return res.status(200).json({ success: true, data: { quoteSession } });
    },
    async accept(req, res) {
      const result = await service.acceptOption({
        client: req.integrationClient,
        quoteSessionId: req.params.quoteSessionId,
        optionId: req.params.optionId,
        idempotencyKey: requireIdempotencyKey(req),
      });
      return res.status(result.statusCode).json({
        success: true, data: { ...result.body, replay: result.replay === true },
      });
    },
  };
}
