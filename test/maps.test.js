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
