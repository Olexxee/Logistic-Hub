import test from "node:test";
import assert from "node:assert/strict";
import { nigeriaGeography, NIGERIA_GEOGRAPHY_SOURCE } from "../seed/nigeria-geography.js";
import {
  buildNigeriaGeographyPlan,
  validateNigeriaGeography,
} from "../scripts/seed-nigeria-geography.js";

function emptyExisting() {
  return { countries: [], states: [], lgas: [] };
}

function completeExisting() {
  const country = { id: "country-existing", code: "NG", name: "Nigeria" };
  const states = nigeriaGeography.map((state, index) => ({
    id: "state-" + index,
    countryId: country.id,
    code: state.code,
    name: state.name,
  }));
  const lgas = states.flatMap((state, index) => nigeriaGeography[index].lgas.map((lga, lgaIndex) => ({
    id: "lga-" + index + "-" + lgaIndex,
    stateId: state.id,
    code: lga.code,
    name: lga.name,
  })));
  return { countries: [country], states, lgas };
}

test("reference dataset contains all 37 state-level units and 774 LGAs", () => {
  assert.deepEqual(validateNigeriaGeography(), {
    stateCount: 37,
    lgaCount: 774,
    fctAreaCouncilCount: 6,
  });
  assert.equal(nigeriaGeography.reduce((sum, state) => sum + state.expectedLgaCount, 0), 774);
});

test("reference data records source provenance and licence", () => {
  assert.equal(NIGERIA_GEOGRAPHY_SOURCE.version, "2026.06");
  assert.equal(NIGERIA_GEOGRAPHY_SOURCE.license, "CC BY 4.0");
  assert.match(NIGERIA_GEOGRAPHY_SOURCE.url, /open-admin-data\/nigeria-administrative-divisions/);
});

test("dataset rejects duplicate state codes", () => {
  const data = structuredClone(nigeriaGeography);
  data[1].code = data[0].code;
  assert.throws(() => validateNigeriaGeography(data), /Duplicate state code/);
});

test("dataset rejects incorrect state-level LGA counts", () => {
  const data = structuredClone(nigeriaGeography);
  data[0].lgas.pop();
  assert.throws(() => validateNigeriaGeography(data), /Expected LGA count mismatch/);
});

test("dataset rejects missing or malformed source identifiers", () => {
  const data = structuredClone(nigeriaGeography);
  data[0].lgas[0].sourceId = "missing";
  assert.throws(() => validateNigeriaGeography(data), /Invalid source LGA ID/);
});

test("dataset rejects an LGA source ID belonging to another state", () => {
  const data = structuredClone(nigeriaGeography);
  data[0].lgas[0].sourceId = "NG002001";
  data[0].lgas[0].code = "NG002001";
  assert.throws(() => validateNigeriaGeography(data), /does not belong to parent state Abia/);
});

test("empty database plan creates one country, 37 states and 774 LGAs", () => {
  const plan = buildNigeriaGeographyPlan(emptyExisting());
  assert.equal(plan.createCountry, true);
  assert.equal(plan.createStateCount, 37);
  assert.equal(plan.createLgaCount, 774);
  assert.equal(plan.matchedStateCount, 0);
  assert.equal(plan.matchedLgaCount, 0);
});

test("complete existing geography is matched without changing existing identifiers", () => {
  const existing = completeExisting();
  const plan = buildNigeriaGeographyPlan(existing);
  assert.equal(plan.createCountry, false);
  assert.equal(plan.createStateCount, 0);
  assert.equal(plan.createLgaCount, 0);
  assert.equal(plan.matchedStateCount, 37);
  assert.equal(plan.matchedLgaCount, 774);
  assert.equal(plan.country.id, "country-existing");
  assert.equal(plan.states[0].existing.id, "state-0");
});

test("existing LGA with a null optional code is matched by canonical name without mutation", () => {
  const existing = completeExisting();
  existing.lgas[0].code = null;
  const plan = buildNigeriaGeographyPlan(existing);
  assert.equal(plan.createLgaCount, 0);
  assert.equal(existing.lgas[0].code, null);
});

test("conflicting existing state code is rejected", () => {
  const existing = completeExisting();
  existing.states[0].code = "NG-ZZ";
  assert.throws(() => buildNigeriaGeographyPlan(existing), /conflicts with reference data for Abia/);
});

test("conflicting existing LGA code is rejected", () => {
  const existing = completeExisting();
  existing.lgas[0].code = "NG999999";
  assert.throws(() => buildNigeriaGeographyPlan(existing), /LGA code conflicts/);
});

test("unrecognised existing LGA is rejected instead of being deleted or ignored", () => {
  const existing = completeExisting();
  existing.lgas.push({ id: "custom-lga", stateId: "state-0", code: null, name: "Unofficial District" });
  assert.throws(() => buildNigeriaGeographyPlan(existing), /Unrecognised existing LGAs in Abia/);
});

test("duplicate existing LGA names are rejected", () => {
  const existing = completeExisting();
  existing.lgas.push({ id: "duplicate-lga", stateId: "state-0", code: "NG999999", name: existing.lgas[0].name.toLowerCase() });
  assert.throws(() => buildNigeriaGeographyPlan(existing), /Duplicate existing LGA in Abia name/);
});

test("unrecognised existing state is rejected", () => {
  const existing = completeExisting();
  existing.states.push({ id: "extra-state", countryId: "country-existing", code: "NG-ZZ", name: "New State" });
  assert.throws(() => buildNigeriaGeographyPlan(existing), /Unrecognised existing state records/);
});
