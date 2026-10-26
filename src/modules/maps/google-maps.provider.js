import {
  geocodeInputSchema,
  geocodeResultSchema,
  routeInputSchema,
  routeResultSchema,
} from "./maps.schemas.js";

const GEOCODING_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

export class GoogleMapsProvider {
  constructor({ apiKey, fetchImpl = fetch }) {
    if (!apiKey || typeof apiKey !== "string") {
      throw new Error("Google Maps API key is required for the Google Maps provider.");
    }
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async geocode(input) {
    const { address } = geocodeInputSchema.parse(input);
    const url = new URL(GEOCODING_URL);
    url.searchParams.set("address", address);
    url.searchParams.set("key", this.apiKey);

    const response = await this.fetchImpl(url, { method: "GET" });
    if (!response.ok) throw new Error("Maps provider geocoding request failed.");

    const payload = await response.json();
    if (payload.status === "ZERO_RESULTS") return null;
    if (payload.status !== "OK" || !payload.results?.[0]) {
      throw new Error("Maps provider could not geocode the supplied address.");
    }

    const result = payload.results[0];
    return geocodeResultSchema.parse({
      formattedAddress: result.formatted_address,
      location: {
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
      },
      placeId: result.place_id || undefined,
    });
  }

  async computeRoute(input) {
    const route = routeInputSchema.parse(input);
    const response = await this.fetchImpl(ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: route.origin.latitude, longitude: route.origin.longitude } } },
        destination: { location: { latLng: { latitude: route.destination.latitude, longitude: route.destination.longitude } } },
        travelMode: route.travelMode,
        computeAlternativeRoutes: false,
      }),
    });

    if (!response.ok) throw new Error("Maps provider route request failed.");
    const payload = await response.json();
    const result = payload.routes?.[0];
    if (!result) return null;

    const durationSeconds = Number.parseInt(String(result.duration || "").replace(/s$/, ""), 10);
    if (!Number.isFinite(durationSeconds) || !Number.isFinite(result.distanceMeters)) {
      throw new Error("Maps provider returned an invalid route result.");
    }

    return routeResultSchema.parse({
      distanceMeters: result.distanceMeters,
      durationSeconds,
      encodedPolyline: result.polyline?.encodedPolyline || undefined,
    });
  }
}
