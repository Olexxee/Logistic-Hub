import {
  autocompleteInputSchema,
  autocompleteResultSchema,
  geocodeInputSchema,
  geocodeResultSchema,
  placeDetailsInputSchema,
  placeDetailsResultSchema,
  routeInputSchema,
  routeResultSchema,
} from "./maps.schemas.js";

const GEOCODING_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const PLACES_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places";
const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

function isNigeriaAddressComponent(components = []) {
  return components.some(component =>
    component.types?.includes("country")
    && (component.shortText || component.short_name) === "NG"
  );
}

export class GoogleMapsProvider {
  constructor({ apiKey, fetchImpl = fetch }) {
    if (!apiKey || typeof apiKey !== "string") {
      throw new Error("Google Maps API key is required for the Google Maps provider.");
    }
    this.apiKey = apiKey;
    this.fetchImpl = fetchImpl;
  }

  async autocomplete(input) {
    const request = autocompleteInputSchema.parse(input);
    const response = await this.fetchImpl(PLACES_AUTOCOMPLETE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types",
      },
      body: JSON.stringify({
        input: request.input,
        includedRegionCodes: ["ng"],
        languageCode: "en",
        includeQueryPredictions: false,
        ...(request.sessionToken ? { sessionToken: request.sessionToken } : {}),
      }),
    });

    if (!response.ok) throw new Error("Maps provider autocomplete request failed.");
    const payload = await response.json();
    const suggestions = (payload.suggestions || [])
      .filter(item => item.placePrediction?.placeId && item.placePrediction?.text?.text)
      .slice(0, 5)
      .map(({ placePrediction }) => ({
        placeId: placePrediction.placeId,
        text: placePrediction.text.text,
        mainText: placePrediction.structuredFormat?.mainText?.text,
        secondaryText: placePrediction.structuredFormat?.secondaryText?.text,
        types: placePrediction.types || [],
      }));

    return autocompleteResultSchema.parse({ suggestions });
  }

  async getPlaceDetails(input) {
    const request = placeDetailsInputSchema.parse(input);
    const url = new URL(`${PLACES_DETAILS_URL}/${encodeURIComponent(request.placeId)}`);
    if (request.sessionToken) url.searchParams.set("sessionToken", request.sessionToken);

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": "id,formattedAddress,location,addressComponents",
      },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Maps provider place details request failed.");

    const place = await response.json();
    if (!isNigeriaAddressComponent(place.addressComponents)) return null;

    const country = place.addressComponents.find(component => component.types?.includes("country"));
    return placeDetailsResultSchema.parse({
      placeId: place.id,
      formattedAddress: place.formattedAddress,
      location: {
        latitude: place.location?.latitude,
        longitude: place.location?.longitude,
      },
      countryCode: country?.shortText,
      addressComponents: (place.addressComponents || []).map(component => ({
        longText: component.longText || "",
        shortText: component.shortText || "",
        types: component.types || [],
      })),
    });
  }

  async geocode(input) {
    const { address } = geocodeInputSchema.parse(input);
    const url = new URL(GEOCODING_URL);
    url.searchParams.set("address", address);
    url.searchParams.set("components", "country:NG");
    url.searchParams.set("key", this.apiKey);

    const response = await this.fetchImpl(url, { method: "GET" });
    if (!response.ok) throw new Error("Maps provider geocoding request failed.");

    const payload = await response.json();
    if (payload.status === "ZERO_RESULTS") return null;
    if (payload.status !== "OK" || !payload.results?.[0]) {
      throw new Error("Maps provider could not geocode the supplied address.");
    }

    const result = payload.results[0];
    if (!isNigeriaAddressComponent(result.address_components)) return null;
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
