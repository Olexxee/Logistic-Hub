## Current implementation stopping point

**Last completed backend milestone:** DRV-03 availability/location hardening and DRV-04A assignment transition/verification hardening are merged (backend PR #93).

**DRV-04B — merged:** PostgreSQL concurrency regression tests are merged in backend PR #95. The disposable PostgreSQL CI workflow passed, proving the booking-level and driver-level active-reservation constraints under concurrent inserts.

**DRV-04C — implemented in PR #96, CI passed, awaiting merge:** an embedded worker expires overdue unpaid reservations only when no payment attempt exists. It atomically marks the assignment FAILED, releases a delivery leg back to READY_FOR_ASSIGNMENT (or returns a ride/legacy parcel booking to MATCHING), expires the accepted offer, conditionally restores an eligible online driver's availability, and records a system booking event. The worker runs in the existing API process; no separate Render service or migration is required.

**Important payment safety boundary:** any existing payment attempt blocks automatic expiry. A provider may still confirm a charge after checkout initialization, so an attempt must be reconciled before the reservation can be released. Payment integration remains disabled; enabling it requires a separate verified-payment reconciliation path for abandoned/failed attempts and late provider events.

**Remaining DRV-04 work:**
- DRV-04C: integrate explicit rejection/cancellation/failure release paths and add PostgreSQL race/rollback coverage.
- DRV-04D: extend integration tests for concurrent verification, retry limits, replay and lifecycle ownership boundaries.
- DRV-04E: verify assignment lifecycle interactions with hub custody while preserving custody as a separate two-party event.
- DRV-04F: complete API/frontend contract review, documentation and regression acceptance.

**Not claimed complete:** explicit rejection/cancellation/failure release integration and DRV-04D–DRV-04F remain outstanding. Staging acceptance, migration rollout and production deployment remain separate gates.

See [Driver Assignment Lifecycle Policy](docs/driver-assignment-lifecycle-policy.md) for lifecycle invariants.

## Single-process deployment

The API, transactional-email outbox worker and unpaid-assignment expiry worker run in one Node process. Render should deploy one backend Web Service using the repository's normal build/install process and `npm start`; no separate worker service is required. Both workers start after the initial database connectivity check, use the same Prisma client, retry after transient failures and stop before Prisma disconnects during SIGTERM/SIGINT shutdown.

Production environment validation still requires the configured Resend provider and valid outbox encryption key. This change does not alter Render environment variables, create a deployment, or change database credentials.
