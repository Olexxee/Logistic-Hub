import { Router } from "express";
import { ZodError } from "zod";
import { env } from "../../config/env.js";
import { createMapsProvider } from "./maps.provider.js";
import {
  autocompleteInputSchema,
  geocodeInputSchema,
  placeDetailsInputSchema,
  routeInputSchema,
} from "./maps.schemas.js";

function validationError(res, message, issues) {
  return res.status(400).json({
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message,
      details: issues?.map(({ path, message: issueMessage }) => ({
        path: path.join("."),
        message: issueMessage,
      })),
    },
  });
}

function mapsUnavailable(res) {
  return res.status(503).json({
    success: false,
    error: { code: "MAPS_UNAVAILABLE", message: "Maps are not configured for this environment." },
  });
}

export function createMapsRouter({ provider = createMapsProvider(env) } = {}) {
  const router = Router();

  router.post("/autocomplete", async (req, res, next) => {
    const parsed = autocompleteInputSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, "The autocomplete request is invalid.", parsed.error.issues);
    if (!provider) return mapsUnavailable(res);

    try {
      const data = await provider.autocomplete(parsed.data);
      return res.status(200).json({ success: true, data });
    } catch (error) {
      if (error instanceof ZodError) return validationError(res, "The autocomplete request is invalid.");
      return next(error);
    }
  });

  router.post("/place-details", async (req, res, next) => {
    const parsed = placeDetailsInputSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, "The place details request is invalid.", parsed.error.issues);
    if (!provider) return mapsUnavailable(res);

    try {
      const data = await provider.getPlaceDetails(parsed.data);
      if (!data) {
        return res.status(404).json({
          success: false,
          error: { code: "LOCATION_NOT_FOUND", message: "No matching Nigerian location was found." },
        });
      }
      return res.status(200).json({ success: true, data });
    } catch (error) {
      if (error instanceof ZodError) return validationError(res, "The place details request is invalid.");
      return next(error);
    }
  });

  router.post("/geocode", async (req, res, next) => {
    const parsed = geocodeInputSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, "The geocoding request is invalid.", parsed.error.issues);
    if (!provider) return mapsUnavailable(res);

    try {
      const data = await provider.geocode(parsed.data);
      if (!data) {
        return res.status(404).json({
          success: false,
          error: { code: "LOCATION_NOT_FOUND", message: "No matching Nigerian location was found." },
        });
      }
      return res.status(200).json({ success: true, data });
    } catch (error) {
      if (error instanceof ZodError) return validationError(res, "The geocoding request is invalid.");
      return next(error);
    }
  });

  router.post("/routes", async (req, res, next) => {
    const parsed = routeInputSchema.safeParse(req.body);
    if (!parsed.success) return validationError(res, "The route request is invalid.", parsed.error.issues);
    if (!provider) return mapsUnavailable(res);

    try {
      const data = await provider.computeRoute(parsed.data);
      if (!data) {
        return res.status(404).json({
          success: false,
          error: { code: "ROUTE_NOT_FOUND", message: "No route was found for the supplied coordinates." },
        });
      }
      return res.status(200).json({ success: true, data });
    } catch (error) {
      if (error instanceof ZodError) return validationError(res, "The route request is invalid.");
      return next(error);
    }
  });

  return router;
}

export const mapsRouter = createMapsRouter();
