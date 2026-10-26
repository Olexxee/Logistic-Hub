import { GoogleMapsProvider } from "./google-maps.provider.js";

export function createMapsProvider(config) {
  if (!config || config.MAPS_PROVIDER === "none") return null;
  if (config.MAPS_PROVIDER === "google") {
    return new GoogleMapsProvider({ apiKey: config.GOOGLE_MAPS_API_KEY });
  }
  throw new Error("Unsupported MAPS_PROVIDER configuration.");
}
