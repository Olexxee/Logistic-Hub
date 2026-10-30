# Backend API Contracts

**Status:** This document describes stable API-wide rules. Use the frontend readiness audit for known route gaps and do not infer runtime availability solely from an OpenAPI path or implementation-status annotation; full route-to-spec parity is still being completed.

- Machine-readable API: [`openapi.yaml`](openapi.yaml)
- Frontend readiness and known backend gaps: [`frontend-contract-readiness.md`](frontend-contract-readiness.md)
- Operational workflows: [`operational-workflows.md`](operational-workflows.md)

## Stable API rules

- Prefix application endpoints with `/api/v1`.
- Use JSON request/response bodies and ISO-8601 UTC timestamps.
- Success responses use `{ success: true, data: ... }`; errors use `{ success: false, error: { code, message, details? } }`.
- Serialize money as decimal strings containing integer minor units (NGN kobo). Never use floating-point currency or send naira decimal values to money endpoints.
- Use `Idempotency-Key` for documented retryable state-changing operations. Current middleware accepts 8–128 non-whitespace characters; clients should generate at least 16 cryptographically random characters and reuse a key only for retries of the same logical request.
- Never accept client-authoritative booking/payment status, assignment ownership, pricing snapshots, payment amount, provider reference, settlement destination, split configuration, verification state or ledger entries.
- Validate both pickup and destination service-zone IDs against current service availability. Reference geography does not imply operational availability.
- Maps credentials remain server-side. Normalize provider responses before returning them.
- Do not assume payment availability from the existence of a route. The current backend forces `PAYMENTS_ENABLED=false`; payment initialization and provider processing are unavailable until explicitly approved by the project owner.
- Refresh tokens are returned in JSON response bodies, not httpOnly cookies. Treat them as credentials: keep them out of logs, URLs, analytics and browser-readable persistent storage where possible.

## Authentication and authorization

- Access tokens are sent as bearer tokens.
- Registration requires `fullName`, `email` and `password`; account activation requires email verification.
- `POST /auth/refresh` is the canonical refresh endpoint. `POST /auth/sessions/refresh` remains a deprecated compatibility alias and must not be used for new clients.
- Logout and logout-all revoke the current session or all user sessions.
- Role checks are enforced server-side. Hiding a UI control is not authorization.
- Booking, assignment, partner and custody reads must remain scoped to the authenticated owner or authorized operational role.

## Money and payment safety

- All amounts are integer minor-unit strings.
- The client never calculates or submits authoritative totals, platform fees, provider references or payout destinations.
- A successful browser redirect is not proof of payment. Only server-verified provider events and reconciliation can change payment state.
- No live payment activation, provider transfer, or production payment configuration is authorized by this contract update.
- Partner payable/settlement routes represent internal operational accounting and reconciliation. They do not imply an external payout integration.

## Contract change discipline

For every backend route change:
1. Update the Express route and request validator.
2. Update the matching OpenAPI path, method, payload, response envelope, authorization and `x-implementation-status`.
3. Add or update service/route tests for ownership, role authorization, state transitions, validation and idempotent replay where applicable.
4. Run `npm test`, `npm run api:validate`, and `npm run db:validate`.
5. Update [`frontend-contract-readiness.md`](frontend-contract-readiness.md) if the frontend's buildable scope or a known gap changes.
