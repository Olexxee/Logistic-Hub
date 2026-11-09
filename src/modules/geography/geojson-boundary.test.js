import test from "node:test";
import assert from "node:assert/strict";
import { validateServiceZoneBoundary } from "./geojson-boundary.js";

const square = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
const polygon = (coordinates = [square]) => ({ type: "Polygon", coordinates });

test("accepts a valid Polygon", () => {
  assert.equal(validateServiceZoneBoundary(polygon()).valid, true);
});

test("accepts a valid MultiPolygon", () => {
  const result = validateServiceZoneBoundary({
    type: "MultiPolygon",
    coordinates: [[square], [[[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]],
  });
  assert.equal(result.valid, true);
});

test("rejects Feature wrappers and unsupported geometry types", () => {
  assert.equal(validateServiceZoneBoundary({ type: "Feature", geometry: polygon() }).valid, false);
  assert.equal(validateServiceZoneBoundary({ type: "Point", coordinates: [0, 0] }).valid, false);
});

test("rejects invalid coordinate order, ranges and non-finite values", () => {
  assert.equal(validateServiceZoneBoundary(polygon([[[181, 0], [2, 0], [2, 2], [0, 2], [181, 0]]])).valid, false);
  assert.equal(validateServiceZoneBoundary(polygon([[[0, 91], [2, 0], [2, 2], [0, 2], [0, 91]]])).valid, false);
  assert.equal(validateServiceZoneBoundary(polygon([[[0, 0], [2, 0], [2, 2], [0, NaN], [0, 0]]])).valid, false);
});

test("rejects unclosed, undersized and duplicate-point rings", () => {
  assert.equal(validateServiceZoneBoundary(polygon([square.slice(0, -1)])).valid, false);
  assert.equal(validateServiceZoneBoundary(polygon([[[0, 0], [1, 0], [0, 0]]])).valid, false);
  assert.equal(validateServiceZoneBoundary(polygon([[[0, 0], [2, 0], [2, 0], [0, 2], [0, 0]]])).valid, false);
});

test("rejects zero-area and self-intersecting rings", () => {
  assert.equal(validateServiceZoneBoundary(polygon([[[0, 0], [1, 1], [2, 2], [0, 0]]])).valid, false);
  assert.equal(validateServiceZoneBoundary(polygon([[[0, 0], [2, 2], [0, 2], [2, 0], [0, 0]]])).valid, false);
});

test("requires holes to be strictly inside the exterior ring", () => {
  const holeOutside = [[3, 3], [4, 3], [4, 4], [3, 4], [3, 3]];
  assert.equal(validateServiceZoneBoundary(polygon([square, holeOutside])).valid, false);
});

test("rejects overlapping or touching MultiPolygon components", () => {
  const touching = [[square], [[[2, 0], [4, 0], [4, 2], [2, 2], [2, 0]]]];
  assert.equal(validateServiceZoneBoundary({ type: "MultiPolygon", coordinates: touching }).valid, false);
});

test("rejects boundaries exceeding the vertex ceiling", () => {
  const many = [];
  for (let i = 0; i < 10001; i += 1) many.push([0, 0]);
  assert.equal(validateServiceZoneBoundary(polygon([many])).valid, false);
});
