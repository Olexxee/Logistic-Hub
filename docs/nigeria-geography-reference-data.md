# Nigeria Geography Reference Data — Backend Side Quest

**Status:** documented; implementation not started  
**Recorded:** 3 November 2026  
**Scope:** canonical country/state/LGA reference data required by geography and service-zone administration

## 1. Why this work is necessary

The backend already has a relational geography hierarchy and ADMIN CRUD endpoints for countries, states and LGAs. Service-zone creation depends on those parent records being present and active. The frontend AH-5.5 service-area workspace selects existing geography records; it does not create or import them.

A schema that supports geography is not evidence that the production or development database contains a complete Nigerian geography dataset. The current record does not establish that all required states and LGAs are present. This must be checked directly before claiming national geography readiness.

## 2. Expected Nigerian reference hierarchy

| Entity | Expected count |
|---|---:|
| Country | 1 (Nigeria) |
| State-level administrative units | 37 (36 states plus the Federal Capital Territory) |
| Local Government Areas | 774 |
| Total records | 812 |

The FCT must be represented according to the existing schema's state-level hierarchy. Do not invent a separate administrative model solely to represent it.

These counts are validation targets, not proof that a chosen source dataset is correct. The source, version, licensing/usage terms and naming conventions must be reviewed before import.

## 3. Existing backend capability

The geography admin API is already implemented and ADMIN-only:

| Method | Endpoint | Purpose |
|---|---|---|
| GET / POST | `/api/v1/geography/admin/countries` | List / create countries |
| PATCH | `/api/v1/geography/admin/countries/:id` | Update country code/name |
| PATCH | `/api/v1/geography/admin/countries/:id/status` | Activate / deactivate country |
| GET / POST | `/api/v1/geography/admin/states` | List / create states; list can filter by country |
| PATCH | `/api/v1/geography/admin/states/:id` | Update state code/name |
| PATCH | `/api/v1/geography/admin/states/:id/status` | Activate / deactivate state |
| GET / POST | `/api/v1/geography/admin/lgas` | List / create LGAs; list can filter by state |
| PATCH | `/api/v1/geography/admin/lgas/:id` | Update LGA code/name |
| DELETE | `/api/v1/geography/admin/lgas/:id` | Delete an LGA only when no service zone references it |

Existing safeguards include parent/child validation, active-parent requirements, country/state deactivation protections and prevention of deleting an LGA referenced by a service zone. Geography mutations use the existing audited admin services. The seed/import must respect the same data model and invariants.

## 4. Required implementation sequence

1. **Inspect the live schema and repository seed conventions.** Confirm the exact Prisma model names, required fields, unique constraints, ID strategy, country/state/LGA relationships and existing seed entry point. Do not assume field names or invent new models.
2. **Audit existing records in the target database.** Produce counts and identify missing, duplicate, inactive, malformed or incorrectly parented records before writing anything.
3. **Select and record a verifiable source dataset.** Record its publisher, source URL, version/retrieval date and license/attribution obligations. Do not silently combine incompatible datasets.
4. **Normalize and validate offline.** Normalize codes and names against the existing schema; check the 37 state-level units and 774 LGAs, uniqueness, parent assignment and spelling. Resolve FCT representation explicitly.
5. **Implement a deterministic, idempotent seed/import.** Use stable natural keys supported by the schema. Re-running must not duplicate records. Do not replace IDs or mutate unrelated records referenced by service zones, hubs, bookings or audit history.
6. **Add dry-run/reporting and fail-fast checks.** Show planned inserts/updates and reject unexpected counts, duplicate keys, unknown parents or ambiguous matches before applying writes.
7. **Run against a disposable database first.** Verify counts, relationships, repeat-run behavior and compatibility with existing migration/CI checks.
8. **Document the exact execution command and operational safeguards.** A production import must be a separately approved operation with a backup/rollback plan; do not run it against production as part of ordinary deployment.

## 5. Idempotency and data-safety requirements

- Prefer stable codes/natural keys over display names alone where the verified source and schema provide them.
- Never delete and recreate the entire geography hierarchy as a shortcut.
- Preserve existing primary keys and parent references whenever records already exist and can be matched unambiguously.
- Do not overwrite service-zone, hub, booking or operational data.
- Do not automatically create service zones, service availability, hubs, partners or rate cards.
- Do not mark every imported state/LGA as serviceable. Geographic existence and operational coverage are separate concepts.
- If existing records cannot be mapped unambiguously, stop and report the conflict for review instead of guessing.
- The seed must not silently deactivate existing geography or rewrite lifecycle state without an explicit, reviewed policy.

## 6. Acceptance criteria

- [ ] Source dataset and license/attribution are recorded.
- [ ] Existing database inventory is captured before import.
- [ ] One Nigeria country record is present and correctly keyed.
- [ ] All 36 states and FCT are represented under Nigeria (37 state-level units).
- [ ] All 774 LGAs are present and attached to the correct state.
- [ ] No duplicate natural keys or orphaned child records remain.
- [ ] Existing geography IDs and operational references are preserved.
- [ ] A second run produces no duplicate records and no unintended changes.
- [ ] Dry-run output and validation report are available.
- [ ] Disposable PostgreSQL validation passes.
- [ ] No service zones, hubs, partners, availability or commercial rates are created by the import.
- [ ] Production execution, if required, is separately approved and backed up.

## 7. Explicitly out of scope

- Frontend country/state/LGA management UI.
- Service-zone creation or coverage decisions.
- Polygon/geofencing enforcement.
- Google Maps or Places integration changes.
- Hub, partner, driver or service-availability provisioning.
- Production data mutation without explicit approval.

## 8. Handoff to the frontend

Once the reference data is imported and verified, the frontend can use the existing geography selectors and admin endpoints. The frontend still needs a separate ADMIN geography-management workspace for ongoing country/state/LGA corrections and additions. The AH-5.5 service-area workspace remains responsible for operational service zones and availability; do not merge these two responsibilities into one unbounded page.

## 9. Current stop point

No source dataset has been approved, no Prisma seed/import implementation has been written, and no database has been mutated by this side quest. The next implementation prompt should begin with schema/seed-convention inspection and target-database inventory, not immediate insertion of a guessed dataset.
