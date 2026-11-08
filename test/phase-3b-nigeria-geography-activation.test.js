import test from "node:test";
import assert from "node:assert/strict";
import { buildNigeriaGeographyPlan } from "../scripts/seed-nigeria-geography.js";
import { nigeriaGeography } from "../seed/nigeria-geography.js";

function existingNigeriaGeography({ countryActive, statesActive }) {
  const country = { id: "country-ng", code: "NG", name: "Nigeria", isActive: countryActive };
  const states = [];
  const lgas = [];

  for (const [stateIndex, state] of nigeriaGeography.entries()) {
    const stateId = "state-" + stateIndex;
    states.push({
      id: stateId,
      countryId: country.id,
      code: state.code,
      name: state.name,
      isActive: statesActive,
    });
    for (const [lgaIndex, lga] of state.lgas.entries()) {
      lgas.push({
        id: stateId + "-lga-" + lgaIndex,
        stateId,
        code: lga.code,
        name: lga.name,
      });
    }
  }

  return { countries: [country], states, lgas };
}

test("Nigeria seed plan detects an inactive country and inactive states for reactivation", () => {
  const plan = buildNigeriaGeographyPlan(existingNigeriaGeography({
    countryActive: false,
    statesActive: false,
  }));

  assert.equal(plan.createCountry, false);
  assert.equal(plan.activateCountry, true);
  assert.equal(plan.activateStateCount, 37);
  assert.equal(plan.createStateCount, 0);
  assert.equal(plan.createLgaCount, 0);
});

test("Nigeria seed plan does not schedule activation when country and states are already active", () => {
  const plan = buildNigeriaGeographyPlan(existingNigeriaGeography({
    countryActive: true,
    statesActive: true,
  }));

  assert.equal(plan.activateCountry, false);
  assert.equal(plan.activateStateCount, 0);
});
