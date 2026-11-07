# GIL-05 — Tracking and Signed Webhooks

**Status:** GIL-04A–GIL-04E and GIL-05A are merged. GIL-05B–05D (endpoint management, signed delivery, replay and end-to-end acceptance) remain unimplemented.

## Objective

Expose a reliable, client-scoped shipment event history and deliver signed, retryable webhook notifications to each integration client. The integration must recover missed events without polling current shipment state indefinitely or trusting delivery order.

## Source-of-truth boundaries

- ParcelBooking, DeliveryLeg, partner assignment and custody records remain the operational source of truth.
- BookingEvent remains the internal audit/event record; it is not itself the external webhook contract.
- The integration event ledger is an immutable, sanitized projection for the owning integration client.
- Webhook delivery status is delivery telemetry only. A failed webhook must never roll back or block an operational shipment transition.
- Integrators use event ID and per-shipment sequence for deduplication and ordering. HTTP delivery order is not guaranteed.

## GIL-05A — Shipment event ledger and tracking API

### Contract

- Supported integration shipment milestones are projected into a durable IntegrationShipmentEvent in the same database transaction as their source operational mutation. The implementation explicitly projects shipment creation, partner assignment, partner leg start and the three mapped custody milestones.
- Event sequence is monotonic per shipment, starts at 1 and has no gaps for successfully committed integration events.
- The source BookingEvent ID is unique in the integration event ledger, preventing duplicate projection.
- Each event contains a stable event ID, schema version, external event type, per-shipment sequence, occurrence timestamp and a minimal sanitized payload containing shipment public reference and resulting status. Internal shipment IDs and leg/partner identifiers are not exposed in the payload.
- Payloads must not contain recipient phone/name, full pickup or destination addresses, package declared values, payment references, partner internal costs, credentials or secrets.
- Event history is scoped by authenticated integrationClientId and integration-owned booking identity. Unknown and other-client shipment IDs return the same not-found response.
- Tracking reads use sequence greater than afterSequence, ascending sequence order and a bounded page size. Clients persist the highest contiguous sequence they have processed.

### Initial event vocabulary

| Internal source event | External event |
|---|---|
| INTEGRATION_SHIPMENT_CREATED | shipment.created |
| INTEGRATION_PARTNER_ASSIGNMENT_CREATED | shipment.partner_assigned |
| INTEGRATION_PARTNER_LEG_STARTED | shipment.in_transit |
| HUB_PICKUP_CUSTODY_CONFIRMED | shipment.custody_handover_confirmed |
| HUB_DESTINATION_CUSTODY_CONFIRMED | shipment.delivery_leg_completed |
| PARTNER_HUB_CUSTODY_CONFIRMED | shipment.delivery_leg_completed |

Only events with an explicit mapping are externally visible. Internal audit events are not forwarded by default.

### Endpoint

GET /api/v1/integrations/shipments/:shipmentId/events?afterSequence=0&limit=50

Requires shipments:read. Response contains ordered events, hasMore and nextAfterSequence. The endpoint is read-only, requires shipments:read, scopes both booking and event queries to the authenticated client, and does not expose internal BookingEvent metadata.

## GIL-05B — Webhook endpoint and signing-secret management

- Endpoint registration is scoped to the authenticated client and requires a dedicated webhooks:manage scope.
- Require HTTPS, reject credentials in URLs, fragments, local/private/link-local/multicast targets and redirects. DNS resolution must be revalidated at delivery time and pinned to validated public addresses to mitigate DNS rebinding and SSRF.
- Display a signing secret once. Store only authenticated encryption of the secret using the configured server-side encryption key.
- Rotation creates a new version; pending deliveries retain access to the exact secret version assigned when the delivery was created.
- Endpoint suspension/revocation prevents new deliveries. It does not erase event history.

## GIL-05C — Signed webhook delivery

- Create one delivery row per event/active subscribed endpoint in the same transaction as the event ledger row.
- Claim work with PostgreSQL FOR UPDATE SKIP LOCKED, a lease owner and expiry, and bounded batches.
- Send the exact serialized request body with HMAC-SHA256 signature over timestamp + "." + rawBody.
- Include event ID, delivery ID, event type, sequence, timestamp and signature headers.
- Disable redirects. Apply strict connection/response timeouts and bounded response-body reads.
- Treat 2xx as success; retry network errors, timeouts, 408, 429 and 5xx with capped exponential backoff; dead-letter permanent 4xx responses and exhausted retries.
- Delivery attempts are at-least-once. Receivers must deduplicate by event ID and verify signatures with constant-time comparison.

## GIL-05D — Replay, operations and acceptance

- Client-scoped replay accepts an event ID or sequence range and requeues only deliveries for an active endpoint; replay does not create a new shipment event or sequence.
- Enforce bounded replay ranges and rate limits; every replay request is audited.
- Provide delivery status, attempt count, last HTTP status/error code, next attempt and terminal state without exposing secret material.
- Acceptance covers event projection atomicity, sequence ordering under concurrent updates, duplicate source-event suppression, cross-client isolation, signature correctness, secret rotation, endpoint SSRF controls, retry classification, lease recovery, dead-lettering, replay bounds and webhook/operational transaction independence.

## Implementation order

| Slice | Scope | Exit criteria |
|---|---|---|
| GIL-05A | Immutable event ledger and client-scoped tracking history | Atomic projection, per-shipment sequence, sanitized event payload and cursor-based tracking API |
| GIL-05B | Endpoint management and secret lifecycle | Client-scoped endpoint CRUD, HTTPS/SSRF controls, one-time secret display and versioned rotation |
| GIL-05C | Signed webhook worker | Durable per-endpoint deliveries, HMAC signatures, leases, retries and dead-lettering |
| GIL-05D | Replay and acceptance | Bounded replay, audit trail, end-to-end contract and PostgreSQL concurrency tests |

GIL-05 does not change booking, payment, custody or partner execution authority. It does not enable Logistic Hub payment collection, refunds, wallet debits, payouts or settlement.
