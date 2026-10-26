import test from "node:test";
import assert from "node:assert/strict";
import { coordinatesSchema, geocodeInputSchema, routeInputSchema } from "../src/modules/maps/maps.schemas.js";
import { createMapsProvider } from "../src/modules/maps/maps.provider.js";
import { GoogleMapsProvider } from "../src/modules/maps/google-maps.provider.js";

test("coordinates enforce latitude and longitude bounds", () => {
  assert.equal(coordinatesSchema.safeParse({ latitude: 6.5, longitude: 3.4 }).success, true);
  assert.equal(coordinatesSchema.safeParse({ latitude: 96, longitude: 3.4 }).success, false);
  assert.equal(coordinatesSchema.safeParse({ latitude: 6.5, longitude: -200 }).success, false);
});

test("map requests reject malformed addresses and routes", () => {
  assert.equal(geocodeInputSchema.safeParse({ address: "Lagos" }).success, true);
  assert.equal(geocodeInputSchema.safeParse({ address: "x" }).success, false);
  assert.equal(routeInputSchema.safeParse({
    origin: { latitude: 6.5, longitude: 3.4 },
    destination: { latitude: 6.6, longitude: 3.5 },
  }).success, true);
  assert.equal(routeInputSchema.safeParse({
    origin: { latitude: 6.5, longitude: 3.4 },
    destination: { latitude: 200, longitude: 3.5 },
  }).success, false);
});

test("maps are explicitly unavailable when provider is none", () => {
  assert.equal(createMapsProvider({ MAPS_PROVIDER: "none" }), null);
});

test("Google Maps provider requires a server-side API key", () => {
  assert.throws(() => new GoogleMapsProvider({ apiKey: "" }), /API key is required/);
  assert.throws(() => createMapsProvider({ MAPS_PROVIDER: "google", GOOGLE_MAPS_API_KEY: "" }), /API key is required/);
});

test("geocoding normalizes provider data and handles no results", async () => {
  const provider = new GoogleMapsProvider({
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{
          formatted_address: "Ikeja, Lagos, Nigeria",
          place_id: "test-place",
          geometry: { location: { lat: 6.6018, lng: 3.3515 } },
        }],
      }),
    }),
  });
  assert.deepEqual(await provider.geocode({ address: "Ikeja, Lagos" }), {
    formattedAddress: "Ikeja, Lagos, Nigeria",
    location: { latitude: 6.6018, longitude: 3.3515 },
    placeId: "test-place",
  });

  const noResults = new GoogleMapsProvider({
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: true, json: async () => ({ status: "ZERO_RESULTS", results: [] }) }),
  });
  assert.equal(await noResults.geocode({ address: "Unknown location" }), null);
});

test("route computation normalizes distance and duration", async () => {
  let requestOptions;
  const provider = new GoogleMapsProvider({
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return {
        ok: true,
        json: async () => ({
          routes: [{
            distanceMeters: 12400,
            duration: "1800s",
            polyline: { encodedPolyline: "encoded-test-route" },
          }],
        }),
      };
    },
  });
  const result = await provider.computeRoute({
    origin: { latitude: 6.5, longitude: 3.4 },
    destination: { latitude: 6.6, longitude: 3.5 },
  });
  assert.deepEqual(result, {
    distanceMeters: 12400,
    durationSeconds: 1800,
    encodedPolyline: "encoded-test-route",
  });
  assert.equal(requestOptions.headers["X-Goog-Api-Key"], "test-key");
  assert.equal(requestOptions.headers["X-Goog-FieldMask"], "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline");
});
