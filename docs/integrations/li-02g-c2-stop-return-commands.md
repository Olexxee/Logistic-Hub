# LI-02G-C2 — Integration shipment stop and return commands

## Status

Implementation is under review in the Logistic Hub C2 pull request. These commands are generic integration-client capabilities; MarketIQ uses them through its client-specific contract. No customer payment or refund action is performed by Logistic Hub.

## Ownership

- The authenticated integration client owns the request and supplies an external fulfilment reference plus a reason.
- Logistic Hub owns booking, delivery-leg, partner-assignment and custody truth.
- MarketIQ remains responsible for buyer order state, customer communications and all refund decisions.
- A command acknowledgement is not a claim that a parcel has physically returned.

Both endpoints require shipments:write, X-Integration-Key-Id, X-Integration-Secret and a valid Idempotency-Key (8–128 characters). The shipment is resolved by the client-scoped SHIPMENT external-reference mapping; the request body cannot select an internal booking or another integration client.

## Stop before custody transfer

POST /api/v1/integrations/shipments/by-external-reference/{externalFulfillmentReference}/stop

Request:

```json
{ "reason": "Buyer cancelled before dispatch" }
```

The stop is allowed only while the integration booking is AWAITING_PARTNER_ASSIGNMENT or DRIVER_ASSIGNED, and only when no confirmed custody handover or in-transit partner assignment shows that the parcel has left the pre-custody window.

Within one serializable transaction, Hub:

1. Cancels active ASSIGNED / ACCEPTED partner assignments.
2. Cancels pending custody handovers.
3. Cancels cancellable planned, ready and assigned delivery legs.
4. Conditionally changes the booking to CANCELLED, recording cancellation time and reason.
5. Writes INTEGRATION_SHIPMENT_STOPPED and projects shipment.cancelled through the existing monotonic event ledger and signed webhook fan-out.
6. Stores the idempotent response.

If assignment, custody or leg state changes during the operation, the transaction fails closed; a partially cancelled shipment is not committed. If the parcel has entered custody or transit, the stop command returns a conflict and instructs the client to use the return-request command.

A prior cancellation not caused by this integration stop command is not reported as a successful stop.

## Return request after custody transfer

POST /api/v1/integrations/shipments/by-external-reference/{externalFulfillmentReference}/return-request

Request:

```json
{ "reason": "Buyer requests return to seller" }
```

The return request is accepted only for a non-terminal shipment that has entered physical execution, evidenced by an in-transit/picked-up booking state or a confirmed custody handover.

Hub records INTEGRATION_RETURN_REQUESTED and projects shipment.return_requested. The booking's operational status is deliberately unchanged. The response is HTTP 202 and explicitly reports physicalReturnConfirmed: false.

This is an acknowledgement that a return request has been received—not a return authorization, return route, successful stop, completed return, seller acceptance, refund approval or refund. The first recorded return request is retained; repeated requests with a different idempotency key do not create duplicate request events.

## Explicit non-goals and remaining work

- No Paystack call, refund request, refund approval or payment-ledger mutation.
- No automatic reversal of partner payable. A payable created by completed execution remains subject to existing settlement controls.
- No fabricated reverse delivery leg or automatic reassignment of the parcel.
- No claim that the parcel is stopped after partner pickup.
- No buyer/seller frontend behavior or MarketIQ webhook projection in this Hub slice.
- Operational ownership, partner instructions, reverse-route planning, custody milestones and terminal return confirmation require a subsequent return-execution slice. Until then, shipment.return_requested is a durable signal for operations and the integration client, not proof of physical action.

## Acceptance tests

- Unassigned integration shipment can be stopped and becomes terminally cancelled.
- Accepted-but-not-transferred partner assignment and pending custody handover are cancelled atomically.
- In-transit/custody-held shipment cannot be falsely marked stopped.
- Assignment, handover or leg state races abort the complete stop transaction.
- Return request is rejected before custody transfer and for terminal shipments.
- Eligible return request emits one durable event and leaves booking status unchanged.
- Duplicate return request with another idempotency key does not create another event.
- Same idempotency key replays the original response; payload mismatch conflicts.
- Non-integration shipment and another client's external reference cannot be targeted.
