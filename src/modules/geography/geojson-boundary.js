const MAX_BOUNDARY_POSITIONS = 2000;
const EPSILON = 1e-12;

function samePoint(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function cross(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, p) {
  return Math.abs(cross(a, b, p)) <= EPSILON &&
    p[0] >= Math.min(a[0], b[0]) - EPSILON &&
    p[0] <= Math.max(a[0], b[0]) + EPSILON &&
    p[1] >= Math.min(a[1], b[1]) - EPSILON &&
    p[1] <= Math.max(a[1], b[1]) + EPSILON;
}

function segmentsIntersect(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
      ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function signedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (onSegment(a, b, point)) return 0;
    const crosses = ((a[1] > point[1]) !== (b[1] > point[1])) &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside ? 1 : -1;
}

function ringEdgesIntersect(a, b) {
  for (let i = 0; i < a.length - 1; i += 1) {
    for (let j = 0; j < b.length - 1; j += 1) {
      if (segmentsIntersect(a[i], a[i + 1], b[j], b[j + 1])) return true;
    }
  }
  return false;
}

function ringSelfIntersects(ring) {
  const edgeCount = ring.length - 1;
  for (let i = 0; i < edgeCount; i += 1) {
    for (let j = i + 1; j < edgeCount; j += 1) {
      if (j === i + 1 || (i === 0 && j === edgeCount - 1)) continue;
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
    }
  }
  return false;
}

function validateRing(ring, path, issues) {
  if (!Array.isArray(ring) || ring.length < 4) {
    issues.push(`${path} must contain at least four positions.`);
    return false;
  }
  for (let i = 0; i < ring.length; i += 1) {
    const point = ring[i];
    if (!Array.isArray(point) || point.length !== 2 ||
        !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
        point[0] < -180 || point[0] > 180 || point[1] < -90 || point[1] > 90) {
      issues.push(`${path}[${i}] must be [longitude, latitude] within WGS 84 ranges.`);
      return false;
    }
    if (i > 0 && samePoint(point, ring[i - 1])) {
      issues.push(`${path} must not contain adjacent duplicate positions.`);
      return false;
    }
  }
  if (!samePoint(ring[0], ring[ring.length - 1])) {
    issues.push(`${path} must be closed (first and last positions must match).`);
    return false;
  }
  if (Math.abs(signedArea(ring)) <= EPSILON) {
    issues.push(`${path} must enclose a non-zero area.`);
    return false;
  }
  if (ringSelfIntersects(ring)) {
    issues.push(`${path} must not self-intersect.`);
    return false;
  }
  return true;
}

function validatePolygon(rings, path, issues) {
  if (!Array.isArray(rings) || rings.length === 0) {
    issues.push(`${path} must contain an exterior ring.`);
    return false;
  }
  const valid = rings.map((ring, index) => validateRing(ring, `${path}[${index}]`, issues));
  if (valid.some(value => !value)) return false;
  const exterior = rings[0];
  for (let i = 1; i < rings.length; i += 1) {
    const hole = rings[i];
    if (ringEdgesIntersect(exterior, hole) || pointInRing(hole[0], exterior) !== 1) {
      issues.push(`${path}[${i}] must be strictly inside the exterior ring and must not touch it.`);
    }
    for (let j = 1; j < i; j += 1) {
      if (ringEdgesIntersect(rings[j], hole) ||
          pointInRing(hole[0], rings[j]) !== -1 ||
          pointInRing(rings[j][0], hole) !== -1) {
        issues.push(`${path}[${i}] must not overlap or touch another hole.`);
      }
    }
  }
  return true;
}

function pointInPolygon(point, polygon) {
  const outer = pointInRing(point, polygon[0]);
  if (outer !== 1) return outer;
  for (let i = 1; i < polygon.length; i += 1) {
    const hole = pointInRing(point, polygon[i]);
    if (hole === 0) return 0;
    if (hole === 1) return -1;
  }
  return 1;
}

function polygonsIntersect(a, b) {
  for (const ringA of a) {
    for (const ringB of b) {
      if (ringEdgesIntersect(ringA, ringB)) return true;
    }
  }
  return pointInPolygon(a[0][0], b) === 1 || pointInPolygon(b[0][0], a) === 1;
}

export function validateServiceZoneBoundary(value) {
  const issues = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, issues: ["Boundary must be a GeoJSON Polygon or MultiPolygon geometry object."] };
  }
  if (value.type !== "Polygon" && value.type !== "MultiPolygon") {
    return { valid: false, issues: ["Boundary type must be Polygon or MultiPolygon."] };
  }
  const positions = [];
  const pending = [value.coordinates];
  let inspectedNodes = 0;
  while (pending.length) {
    const node = pending.pop();
    inspectedNodes += 1;
    if (inspectedNodes > MAX_BOUNDARY_POSITIONS * 4) {
      return { valid: false, issues: ["Boundary coordinate structure exceeds the validation complexity limit."] };
    }
    if (!Array.isArray(node)) continue;
    if (node.length === 2 && node.every(Number.isFinite)) positions.push(node);
    else pending.push(...node);
  }
  if (positions.length > MAX_BOUNDARY_POSITIONS) {
    return { valid: false, issues: [`Boundary exceeds the ${MAX_BOUNDARY_POSITIONS} position limit.`] };
  }
  if (value.type === "Polygon") {
    validatePolygon(value.coordinates, "coordinates", issues);
  } else if (!Array.isArray(value.coordinates) || value.coordinates.length === 0) {
    issues.push("coordinates must contain at least one polygon.");
  } else {
    const polygons = value.coordinates;
    const valid = polygons.map((polygon, index) => validatePolygon(polygon, `coordinates[${index}]`, issues));
    if (valid.every(Boolean)) {
      for (let i = 0; i < polygons.length; i += 1) {
        for (let j = i + 1; j < polygons.length; j += 1) {
          if (polygonsIntersect(polygons[i], polygons[j])) {
            issues.push(`coordinates[${i}] must not overlap or touch coordinates[${j}].`);
          }
        }
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

export const serviceZoneBoundaryPositionLimit = MAX_BOUNDARY_POSITIONS;
