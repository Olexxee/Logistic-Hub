import { Router } from "express";
import { ZodError } from "zod";
import { env } from "../../config/env.js";
import { createMapsProvider } from "./maps.provider.js";
import { geocodeInputSchema, routeInputSchema } from "./maps.schemas.js";

export function createMapsRouter({ provider = createMapsProvider(env) } = {}) {
  const router = Router();

  router.post("/geocode", async (req, res, next) => {
    const parsed = geocodeInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "The geocoding request is invalid.",
          details: parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
        },
      });
    }

    if (!provider) {
      return res.status(503).json({
        success: false,
        error: { code: "MAPS_UNAVAILABLE", message: "Maps are not configured for this environment." },
      });
    }

    try {
      const data = await provider.geocode(parsed.data);
      if (!data) {
        return res.status(404).json({
          success: false,
          error: { code: "LOCATION_NOT_FOUND", message: "No matching location was found." },
        });
      }
      return res.status(200).json({ success: true, data });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "The geocoding request is invalid." },
        });
      }
      return next(error);
    }
  });

  router.post("/routes", async (req, res, next) => {
    const parsed = routeInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "The route request is invalid.",
          details: parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
        },
      });
    }

    if (!provider) {
      return res.status(503).json({
        success: false,
        error: { code: "MAPS_UNAVAILABLE", message: "Maps are not configured for this environment." },
      });
    }

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
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "The route request is invalid." },
        });
      }
      return next(error);
    }
  });

  return router;
}

export const mapsRouter = createMapsRouter();
