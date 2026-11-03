import test from "node:test";
import assert from "node:assert/strict";
import { GoogleMapsProvider } from "./google-maps.provider.js";

function response(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

test("autocomplete restricts suggestions to Nigeria and normalizes place predictions", async () => {
  let request;
  const provider = new GoogleMapsProvider({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return response({
        suggestions: [{
          placePrediction: {
            placeId: "place-123",
            text: { text: "Ikeja, Lagos, Nigeria" },
            structuredFormat: {
              mainText: { text: "Ikeja" },
              secondaryText: { text: "Lagos, Nigeria" },
            },
            types: ["locality", "political"],
          },
        }],
      });
    },
  });

  const result = await provider.autocomplete({ input: "Ikeja", sessionToken: "session-123" });
  assert.deepEqual(result.suggestions[0], {
    placeId: "place-123",
    text: "Ikeja, Lagos, Nigeria",
    mainText: "Ikeja",
    secondaryText: "Lagos, Nigeria",
    types: ["locality", "political"],
  });
  assert.equal(request.url, "https://places.googleapis.com/v1/places:autocomplete");
  assert.equal(request.options.headers["X-Goog-Api-Key"], "test-key");
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.includedRegionCodes, ["ng"]);
  assert.equal(body.sessionToken, "session-123");
  assert.equal(body.includeQueryPredictions, false);
});

test("autocomplete returns an empty list when Google has no predictions", async () => {
  const provider = new GoogleMapsProvider({
    apiKey: "test-key",
    fetchImpl: async () => response({ suggestions: [] }),
  });
  assert.deepEqual(await provider.autocomplete({ input: "No matching address" }), { suggestions: [] });
});

test("place details returns normalized Nigerian address components", async () => {
  let request;
  const provider = new GoogleMapsProvider({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return response({
        id: "place-123",
        formattedAddress: "Ikeja, Lagos, Nigeria",
        location: { latitude: 6.6018, longitude: 3.3515 },
        addressComponents: [
          { longText: "Nigeria", shortText: "NG", types: ["country"] },
          { longText: "Lagos", shortText: "LA", types: ["administrative_area_level_1"] },
        ],
      });
    },
  });

  const result = await provider.getPlaceDetails({ placeId: "place-123", sessionToken: "session-123" });
  assert.equal(result.countryCode, "NG");
  assert.equal(result.location.latitude, 6.6018);
  assert.equal(result.addressComponents.length, 2);
  assert.match(request.url, /sessionToken=session-123/);
  assert.equal(request.options.headers["X-Goog-FieldMask"], "id,formattedAddress,location,addressComponents");
});

test("place details rejects results outside Nigeria", async () => {
  const provider = new GoogleMapsProvider({
    apiKey: "test-key",
    fetchImpl: async () => response({
      id: "place-456",
      formattedAddress: "Accra, Ghana",
      location: { latitude: 5.6037, longitude: -0.187 },
      addressComponents: [{ longText: "Ghana", shortText: "GH", types: ["country"] }],
    }),
  });
  assert.equal(await provider.getPlaceDetails({ placeId: "place-456" }), null);
});

test("geocoding is restricted to and verifies Nigeria", async () => {
  let requestUrl;
  const provider = new GoogleMapsProvider({
    apiKey: "test-key",
    fetchImpl: async url => {
      requestUrl = new URL(url);
      return response({
        status: "OK",
        results: [{
          formatted_address: "Ikeja, Lagos, Nigeria",
          place_id: "place-123",
          geometry: { location: { lat: 6.6018, lng: 3.3515 } },
          address_components: [{ shortText: "NG", types: ["country"] }],
        }],
      });
    },
  });

  const result = await provider.geocode({ address: "Ikeja" });
  assert.equal(result.location.latitude, 6.6018);
  assert.equal(requestUrl.searchParams.get("components"), "country:NG");
});
