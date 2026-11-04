## Current implementation stopping point

**Last completed backend milestone:** DRV-03 availability/location hardening and DRV-04A assignment transition/verification hardening are merged (backend PR #93).

**Current implementation slice:** DRV-04B adds disposable-PostgreSQL race tests for the existing partial unique indexes: concurrent reservations for the same booking/leg and concurrent reservations by the same driver. The tests assert one committed reservation and one PostgreSQL unique-constraint rejection. This work is in an open PR until CI passes; it is not yet a merged milestone.

**Next unfinished DRV-04 work:**
- DRV-04C: implement and test expiry/release/reassignment for rejected, cancelled, failed and unpaid assignments without stale reservations.
- DRV-04C: implement and test expiry/release/reassignment for rejected, cancelled, failed and unpaid assignments without stale reservations.
- DRV-04D: extend integration tests for concurrent verification, retry limits, replay and lifecycle ownership boundaries.
- DRV-04E: verify assignment lifecycle interactions with hub custody while preserving custody as a separate two-party event.
- DRV-04F: complete API/frontend contract review, documentation and regression acceptance.

**Not claimed complete:** no automatic unpaid-reservation expiry/reassignment has been delivered by DRV-04A. Driver frontend work is not part of the backend closeout yet. Staging acceptance, migration rollout and production deployment remain separate gates.

See [Driver Assignment Lifecycle Policy](docs/driver-assignment-lifecycle-policy.md) for the detailed invariants.

## Single-process deployment

The API and transactional-email outbox worker now run in the same Node process. Render should deploy one backend Web Service using the repository's normal build/install process and `npm start`; do not create a separate Render Background Worker for `src/workers/worker.js`. The server starts the embedded outbox poller only after its initial PostgreSQL connection succeeds and the email provider is configured. The poller uses the same Prisma client, catches poll errors without taking down HTTP, and stops before Prisma disconnects during SIGTERM/SIGINT shutdown. In non-production environments without a configured email provider, the API stays available and logs that the worker is disabled.

Production environment validation still requires the configured Resend provider and valid outbox encryption key. This change does not alter Render environment variables, create a deployment, or change database credentials.
