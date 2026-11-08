# LI-02G-C1A — End-to-end delivery closure

## Status

Implementation is under review in Logistic Hub PR #116. This slice is a prerequisite to LI-02G-C stop and return coordination.

## Problem

Integration shipments using the end-to-end route create a single interstate partner leg without a destination hub. The custody workflow previously completed partner execution only when a transport partner handed the parcel to a destination hub. A partner handover to the verified recipient could be confirmed as custody, but it did not complete the partner assignment, delivery leg or booking, and it did not project a terminal shipment event to the integration client.

The existing partner-to-hub path also left the booking in `IN_TRANSIT` after completing the leg. That is intentional for hub custody because a later leg may still be required; it must not be confused with recipient delivery.

## Contract

A direct partner-to-recipient handover completes an integration shipment only when all conditions hold:

- The releasing party is the transport partner assigned to the leg and its assignment is `IN_TRANSIT`.
- The receiving party is the booking's verified recipient. Existing active-account, verified-phone and booking-phone matching checks remain mandatory.
- The leg is `INTERSTATE_TRANSPORT`.
- The leg has no destination hub.
- The booking is integration-owned (`integrationClientId` is present).
- No later delivery leg exists.

The confirmation runs within the existing serializable custody transaction. It atomically:

1. Confirms the custody handover.
2. Completes the partner assignment and delivery leg.
3. Creates or reuses the partner payable using the existing unique assignment relationship.
4. Marks the parcel booking `COMPLETED`.
5. Writes a booking event and projects `shipment.delivery_leg_completed` through the existing integration event ledger and webhook fan-out.

A partner-to-hub handover continues to complete only the current partner leg. It leaves the booking `IN_TRANSIT` so the next planned leg can be activated and completed independently.

## Explicit non-goals

- No cancellation, stop, return, or refund behavior.
- No new database migration or enum value.
- No direct browser-to-Hub command.
- No change to MarketIQ's payment authority or refund ownership.
- No production deployment, migration, worker enablement, or environment change.

## Acceptance tests

- A verified recipient can confirm a partner-to-recipient handover for an integration end-to-end shipment.
- The assignment and leg become `COMPLETED`.
- The booking becomes `COMPLETED`.
- Exactly one payable is created/reused for the partner assignment.
- The integration event is projected as `shipment.delivery_leg_completed`.
- Existing partner-to-hub completion behavior remains intact.
- A recipient handover cannot complete an ordinary/non-integration booking, a leg with a destination hub, or a leg with a later planned leg.
