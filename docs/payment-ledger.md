# Payment Ledger and Settlement Design

## 1. Objectives

- Customer pays through Logistic Hub.
- The agreed driver fare and Logistic Hub connection fee are separate line items.
- Logistic Hub does not calculate a percentage commission from driver fare.
- The backend, not the client, determines whether a payment succeeded.
- Each financial movement is auditable and reconcilable.
- Driver payable and provider payout are separate facts.
- Paystack capabilities, terms and settlement timing must be confirmed for the merchant account before production use.

This document is an engineering design, not legal, tax or accounting advice. A Nigerian accountant and legal adviser should review the final chart of accounts, custody/settlement arrangement, fee treatment and customer terms.

## 2. Amount representation

Use integer minor units. For NGN, store kobo as an integer/BigInt. Never use JavaScript floating-point arithmetic for money.

A confirmed quote stores:
- `currency` = `NGN` for the initial market.
- `driverFareMinor`.
- `connectionFeeMinor`.
- `otherChargesMinor`, only for explicit, disclosed charges.
- `customerPayableMinor`.
- `pricingRuleId` and immutable calculation snapshot.
- Quote creation/expiry and customer acceptance timestamps.

Invariant:

```text
customerPayableMinor
  = driverFareMinor
  + connectionFeeMinor
  + otherChargesMinor
```

The payment provider's fee and its payer are separate ledger facts. Do not silently subtract it from the driver's agreed fare. If a fee is passed to the customer, disclose it before payment and validate that the arrangement is permitted.

## 3. Conceptual chart of accounts

Use a double-entry journal. Each posted journal balances within a currency. Account codes are configuration, not hardcoded into booking controllers.

| Account | Type | Purpose |
|---|---|---|
| Provider clearing | Asset | Amounts confirmed/settled by provider but not yet reconciled to bank settlement |
| Driver payable | Liability | Amount owed to a driver under the agreed policy |
| Connection-fee revenue | Revenue | Logistic Hub's fixed connection fee, subject to accounting recognition policy |
| Customer refund payable | Liability | Approved refunds awaiting provider execution |
| Payout clearing | Asset/liability per accountant's chart | Driver payout initiated but not yet provider-confirmed |
| Payment-processing expense | Expense | Provider fees borne by Logistic Hub |
| Suspense/adjustment | Restricted account | Temporary reconciliation exceptions; every entry requires reason and audit trail |

The exact debit/credit treatment depends on the provider's settlement arrangement and accounting advice. The examples below illustrate the ledger shape, not a final chart-of-accounts posting policy.

## 4. Example customer payment

Assume a hypothetical booking:
- Driver fare: ₦4,000.
- Connection fee: ₦300.
- Other customer charges: ₦0.
- Customer total: ₦4,300.

After authoritative payment verification, a conceptual journal may record:
- Debit provider clearing: ₦4,300.
- Credit driver payable: ₦4,000.
- Credit connection-fee revenue: ₦300.

If the provider deducts its fee from settlement, record the provider fee in a separate journal based on the actual provider transaction/settlement record. Do not falsify the customer payment amount or driver fare to make the net settlement appear to balance.

The system must not post this journal when payment is merely initialized, pending, or inferred from a browser redirect.

## 5. Core records and constraints

### Payment attempt

Each attempt has:
- Internal ID.
- Booking reference.
- Provider.
- Unique idempotency key.
- Provider reference (unique when present).
- Expected amount and currency.
- Explicit driver and platform allocation amounts when split routing is used.
- Immutable settlement-routing snapshot identifying the approved routing configuration and driver settlement destination.
- Provider fee, status and timestamps.
- Provider response metadata with secrets and unnecessary personal data removed.

A driver's settlement destination is stored as a provider-scoped account reference with an eligibility status. The provider account reference is not proof of successful verification or payout eligibility. Only activate a destination after the provider confirms the account and the business has approved the settlement policy.

### Ledger journal

Each journal has a unique reference and a set of ledger entries. A journal is immutable after posting. If a posting is wrong, post a compensating journal referencing the original.

Required invariants:
- Every entry amount is greater than zero.
- Debits equal credits for every posted journal and currency.
- Every journal has a unique idempotency/source key.
- All entries in a journal share the same currency unless a proper FX journal model is introduced.
- A provider event cannot post the same payment twice.
- Posted ledger entries cannot be deleted or edited by ordinary application code.
- Financial adjustments record actor, reason, source and correlation ID.

Prisma's basic model does not enforce aggregate debit/credit balance across rows. Implement journal posting inside a database transaction in a dedicated ledger service, and add database-level protection where practical. Add a reconciliation test that independently verifies every posted journal.

### Driver payable and payout

The driver payable is created when the financial recognition policy says the driver has earned the fare. It remains outstanding until a provider-confirmed payout is reconciled.

A payout record includes:
- Driver.
- Booking reference.
- Amount and currency.
- Provider and idempotency key.
- Provider transfer reference.
- Status, timestamps and failure reason.
- Related ledger journal entries.

A failed payout must leave the driver payable outstanding and create a retry/reconciliation task. Do not create a second payout while an equivalent payout is still processing or its provider result is unknown.

## 6. Paystack payment lifecycle

1. Backend creates/locks the booking's final price snapshot.
2. Backend creates a payment attempt with a unique internal reference/idempotency key.
3. Backend initializes Paystack with exact amount, currency and metadata required for reconciliation.
4. Client is redirected to provider checkout or uses the supported checkout interface.
5. Provider webhook and/or server-side verification returns the transaction outcome.
6. Backend validates reference, expected amount, currency, transaction status and booking ownership.
7. Persist the raw event safely with secrets removed; record provider event ID/reference for deduplication.
8. In one database transaction, transition the payment attempt to success, post the ledger journal once, update booking payment state and create a durable outbox job for matching.
9. Acknowledge the webhook only after durable processing, or persist the event for reliable asynchronous processing according to the selected webhook architecture.
10. Reconcile internal payments with provider transaction and settlement reports.

Use a unique provider reference and idempotency key. Handle duplicated and out-of-order webhooks. A late failure event must not overwrite a verified success; conflicting provider events go to reconciliation.

Never expose the Paystack secret key to the client. Never trust client-supplied amount, status or metadata as authoritative.

## 7. Split payment versus transfer

These are different payment mechanics and must not be treated as interchangeable.

- Split settlement can route funds among configured subaccounts when the account/product and transaction configuration support it.
- A transfer is a separate payout operation to a recipient.
- Neither capability alone should be described as escrow.
- Delayed settlement, refunds, reversals, transfer limits, recipient onboarding, processing fees and reconciliation behaviour depend on the selected Paystack product and the merchant account's eligibility/terms.

Before implementation chooses one:
1. Confirm with Paystack which product supports the proposed marketplace structure.
2. Confirm whether driver recipients need subaccounts, transfer recipients or another onboarding model.
3. Confirm who is merchant of record and responsible for refunds/chargebacks.
4. Confirm whether the platform can hold the driver payable until the chosen milestone.
5. Confirm the treatment of failed/returned transfers and split reversals.
6. Confirm fee allocation and settlement report availability.
7. Document the agreed flow and test it in Paystack test mode.

Until those checks are complete, implement a provider adapter and ledger abstraction; do not hardwire an unverified settlement assumption into booking logic.

## 8. Refunds, cancellations and disputes

Refund is a separate record with its own idempotency key, provider reference and lifecycle. It must link to the original payment and booking.

Refund policy must define at least:
- Payment succeeded but no driver is found.
- Customer cancels before a driver accepts.
- Driver cancels before pickup.
- Sender cancels after assignment but before pickup.
- Driver cancels or reports a problem after pickup.
- Recipient is unavailable.
- Duplicate payment.
- Dispute or damaged/lost parcel.
- Provider refund fails or remains pending.

Never issue a refund solely because the client says payment failed. Verify provider status first. Never refund more than the refundable balance. When a refund succeeds, post compensating ledger entries; preserve original payment and revenue history. Any retained connection fee must be explicitly disclosed and approved by the cancellation policy and legal review.

## 9. Reconciliation jobs

Run scheduled reconciliation for:
- Payment attempts stuck in pending.
- Provider-success transactions absent from the internal ledger.
- Internal successes with provider failures or missing provider records.
- Settlement differences and provider fees.
- Driver payouts in processing beyond the expected time.
- Provider-confirmed transfers missing in the internal payout state.
- Refunds that are pending, failed or duplicated.
- Ledger journals that do not balance.

Every exception creates a durable reconciliation record or support case, with a retry policy and escalation path. Do not silently patch financial records.

## 10. Required tests before live payments

- Repeated success webhook creates one journal and one matching task.
- Browser redirect says success but provider verification fails.
- Provider confirms success before redirect is received.
- Wrong amount, currency or reference is rejected.
- Duplicate payment attempts are detected.
- Refund is retried idempotently.
- Payout timeout does not create duplicate transfer.
- Failed payout leaves driver payable outstanding.
- Journal debit/credit totals balance.
- Reconciliation detects provider/internal mismatch.
- Customer cannot access another customer's payment.
- Driver cannot change fare, connection fee or payout amount.
- Manual adjustments require permission, reason and audit record.
