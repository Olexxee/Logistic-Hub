export const PLATFORM_ROUTE_WEIGHT_BANDS = Object.freeze([
  Object.freeze({ id: "UP_TO_1_KG", label: "0.001–1.000 kg", minWeightGrams: 1, maxWeightGrams: 1000 }),
  Object.freeze({ id: "OVER_1_TO_3_KG", label: "1.001–3.000 kg", minWeightGrams: 1001, maxWeightGrams: 3000 }),
  Object.freeze({ id: "OVER_3_TO_5_KG", label: "3.001–5.000 kg", minWeightGrams: 3001, maxWeightGrams: 5000 }),
  Object.freeze({ id: "OVER_5_TO_10_KG", label: "5.001–10.000 kg", minWeightGrams: 5001, maxWeightGrams: 10000 }),
  Object.freeze({ id: "OVER_10_TO_15_KG", label: "10.001–15.000 kg", minWeightGrams: 10001, maxWeightGrams: 15000 }),
  Object.freeze({ id: "OVER_15_TO_20_KG", label: "15.001–20.000 kg", minWeightGrams: 15001, maxWeightGrams: 20000 }),
  Object.freeze({ id: "OVER_20_TO_30_KG", label: "20.001–30.000 kg", minWeightGrams: 20001, maxWeightGrams: 30000 }),
]);

export function findPlatformRouteWeightBand(minWeightGrams, maxWeightGrams) {
  return PLATFORM_ROUTE_WEIGHT_BANDS.find(
    band => band.minWeightGrams === minWeightGrams && band.maxWeightGrams === maxWeightGrams,
  ) ?? null;
}

export function isCanonicalPlatformRouteWeightBand(minWeightGrams, maxWeightGrams) {
  return findPlatformRouteWeightBand(minWeightGrams, maxWeightGrams) !== null;
}
