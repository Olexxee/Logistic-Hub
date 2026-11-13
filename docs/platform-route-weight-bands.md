# Platform route pricing weight-band policy

**Workstream:** ADM-PRICING-02  
**Status:** Initial standard defined; implementation in progress.

## Scope

The platform uses one canonical parcel-weight catalogue for platform-operated parcel tariffs. It is a tariff classification standard, not a claim that every route accepts every band. Each directed corridor and parcel category must have its own explicitly configured tariff for each supported band.

| Band | Inclusive weight range | Integer gram boundaries |
|---|---:|---:|
| Small parcel | 0.001–1.000 kg | 1–1,000 g |
| Light parcel | 1.001–3.000 kg | 1,001–3,000 g |
| Standard parcel | 3.001–5.000 kg | 3,001–5,000 g |
| Medium parcel | 5.001–10.000 kg | 5,001–10,000 g |
| Large parcel | 10.001–15.000 kg | 10,001–15,000 g |
| Heavy parcel | 15.001–20.000 kg | 15,001–20,000 g |
| Extra-heavy parcel | 20.001–30.000 kg | 20,001–30,000 g |

The intervals are inclusive, contiguous and non-overlapping. Weight below 1 gram is not a valid parcel measurement. Weight above 30 kg is outside automatic parcel tariffing and requires manual freight assessment.

## Enforcement rules

1. The Admin interface selects one canonical band; it does not accept arbitrary minimum/maximum ranges.
2. The API accepts only the exact inclusive gram boundaries listed above.
3. The backend stores and assesses integer grams. The interface displays kilograms to three decimal places.
4. A tariff applies only to its directed origin/destination corridor, parcel category, currency and effective window.
5. Every package must match exactly one active tariff. No fallback price is inferred when coverage is missing. Tariff assessment ignores active legacy rates whose boundaries are not one of the canonical bands; audit and replace those records before deploying this enforcement to a live environment.
6. Route availability, endpoint serviceability, operational capacity and dispatch eligibility remain separate requirements.
7. Dimensions remain optional maximum-size constraints. Volumetric-weight calculation is not part of this policy.
8. Each band requires its own tariff amount; bands do not imply a price multiplier or a national flat rate.

## Commercial rationale and limits

These are initial operating bands for a Nigerian parcel network: the lower bands cover common documents and small-commerce parcels; upper bands provide controlled coverage for heavier cartons without silently treating freight as ordinary motorcycle dispatch. The 30 kg ceiling is a platform risk boundary, not a statutory Nigerian parcel limit. Vehicle suitability, provider capability, packaging, dimensions and corridor operations can impose stricter limits.

The bands do not assert that all Nigerian states, LGAs, routes or service zones are active. Coverage is configured corridor by corridor. A reverse route is a separate commercial tariff.

## Release gates

- Backend schema validation rejects non-canonical bands.
- Publishing also rejects legacy draft tariffs outside the canonical catalogue.
- Admin creation selects a canonical band and sends its exact gram boundaries.
- Tariff register identifies the canonical band from stored boundaries; legacy non-canonical records remain visibly identified rather than being mislabeled.
- Backend unit tests cover every accepted band, boundary, gap, overlap and the >30 kg rejection.
- Before production deployment, audit existing ACTIVE tariffs for non-canonical boundaries and create replacement canonical tariffs where needed; legacy active tariffs remain visible in Admin but no longer match package assessments.
- Frontend typecheck/build and backend tests pass before the branch is considered ready.
- No migration is required because the existing database columns already store integer gram bounds.
