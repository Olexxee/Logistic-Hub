# Nigeria geography reference data and seed

## Scope

This dataset supplies only foundational reference geography for Logistic Hub:

- 1 country: Nigeria (NG)
- 36 states plus the Federal Capital Territory (37 state-level units)
- 774 Local Government Areas / FCT Area Councils

It does **not** create service zones, service availability, hubs, partners, rate cards, or operational coverage. Geography records are not evidence that Logistic Hub serves those locations. Country and state records are created with the Prisma defaults, so isActive remains false.

## Source and attribution

- Dataset: Nigeria Administrative Divisions Dataset
- Repository: https://github.com/open-admin-data/nigeria-administrative-divisions
- Release: 2026.06, released 2026-06-01
- Data files used: data/all-state.json and data/all-lga.json
- Licence: Creative Commons Attribution 4.0 International (CC BY 4.0): https://creativecommons.org/licenses/by/4.0/
- Dataset attribution: jakkrapongt, Nigeria Administrative Divisions Dataset, version 2026.06.
- Upstream dataset reports its source basis as OCHA COD-AB (HDX) and INEC Nigeria. See the upstream repository for its source notes and updates.
- Retrieval date for this repository snapshot: 2026-11-03.

The committed dataset preserves upstream state and LGA names and upstream administrative IDs. State codes retain the existing Logistic Hub NG-* codes; LGA code values use upstream stable IDs such as NG001001. Changes to the upstream dataset must be reviewed and attributed before replacing this snapshot.

## Files

- seed/nigeria-geography.js: locally stored source-derived dataset and provenance metadata.
- scripts/seed-nigeria-geography.js: read-only-by-default Prisma seed runner with validation, conflict detection and explicit apply mode.
- test/nigeria-geography-seed.test.js: dataset and reconciliation tests.

## Commands

The runner defaults to a read-only dry run. It reads the target database and prints the country/state/LGA records it would create or match. It does not write data.

~~~bash
npm run db:seed:nigeria
~~~

To apply, pass both --apply and the exact database name parsed from DATABASE_URL:

~~~bash
npm run db:seed:nigeria -- --apply --confirm-database=<database-name>
~~~

When NODE_ENV=production, the runner additionally refuses to write unless the operator explicitly supplies --allow-production:

~~~bash
npm run db:seed:nigeria -- --apply --confirm-database=<database-name> --allow-production
~~~

Do not copy these commands into a production shell until the dry-run output, database host and database name have been independently checked. Example for a database named with spaces: npm run db:seed:nigeria -- --apply --confirm-database="the logistic hub". The seed is not run automatically during deployment, installation or migration.

## Safety and matching behaviour

- The default mode performs no writes.
- Apply mode requires explicit confirmation of the database name. Production mode requires an additional explicit flag.
- The runner validates the complete dataset before connecting to the database.
- Existing records are matched by canonical code and normalized name within their parent. Existing IDs and parent relationships are retained.
- Existing optional LGA codes that are null are left unchanged; the seed does not rewrite existing records.
- A code/name disagreement, duplicate, extra state/LGA, or ambiguous match stops the operation before writes. Resolve such conflicts deliberately; the script never deletes or silently renames records.
- Writes run in one serializable transaction. A failed write or post-write count check rolls back the transaction.
- Only Country, State and LGA models are read or written. No operational geography or coverage models are touched.

## Verification

The script verifies after apply that the Nigeria country record has exactly 37 state-level records and those states contain exactly 774 LGAs/Area Councils. Automated tests validate dataset counts, FCT's six Area Councils, source IDs, duplicate rejection, empty-database planning, existing-ID preservation, and conflict detection.

Run the tests with:

~~~bash
npm test
~~~

## Operational note

This implementation does not execute against Render or any other hosted database. Run a dry run first and inspect the exact target and proposed additions. Production execution is a separate operational decision and must be explicitly approved.
