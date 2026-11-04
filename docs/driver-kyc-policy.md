# Driver verification and staged KYC policy

## Purpose

The driver workflow supports controlled product testing before full KYC operations are ready. Reduced checks are represented explicitly as a **TEST_LIMITED** tier; they are not represented as full identity verification.

`verificationStatus` answers whether the platform has approved the driver profile. `kycTier` answers what level of evidence and operational capability that approval carries. These are deliberately separate. Existing profiles are migrated as `UNASSESSED`; they are not silently upgraded to FULL. An Admin must explicitly review them under the active mode before they can become dispatch-eligible.

## Environment controls

| Setting | Values | Default |
|---|---|---|
| `APP_STAGE` | `local`, `staging`, `production` | Derived from `NODE_ENV` |
| `DRIVER_KYC_MODE` | `TEST`, `STRICT` | `TEST` for local/staging; `STRICT` for production |

`APP_STAGE=production` rejects `DRIVER_KYC_MODE=TEST`. A staging deployment must set `APP_STAGE=staging` explicitly if its `NODE_ENV` is production. Do not change `NODE_ENV` merely to bypass the KYC guard.

## TEST mode

An Admin may approve a driver profile without identity or licence documents. The approval is recorded as `verificationStatus=VERIFIED` and `kycTier=TEST_LIMITED`. Profiles with `kycTier=UNASSESSED` remain ineligible until reviewed.

TEST_LIMITED drivers:
- May receive local parcel-delivery opportunities only.
- Must still have an active account, a verified/active vehicle, enabled parcel-delivery coverage, online/available state and a fresh location.
- Cannot receive passenger-ride offers or execute passenger-ride assignments.
- Do not accrue driver payout records on completion.
- Remain blocked from dispatch and assignment execution if suspended or no longer verified.
- Must not be described in the product or admin workspace as fully KYC-verified.

TEST mode does not enable payment checkout or provider payouts. Existing payment and refund activation gates remain unchanged.

## STRICT mode

Strict review requires:
- An Admin-approved `IDENTITY` document before driver-profile approval.
- For non-bicycle vehicles, Admin-approved `DRIVER_LICENSE` and `VEHICLE_REGISTRATION` documents before vehicle approval.
- The document must belong to the same driver profile; vehicle documents must be linked to a vehicle owned by that profile.

These are the platform's initial strict-mode evidence gates, not a claim that every statutory or regulatory KYC obligation has been implemented. Additional document types exist for insurance and roadworthiness, but are not yet mandatory.

## Document handling

- Accepted uploads: JPEG, PNG, WebP and PDF; maximum 10 MB.
- The API validates file signatures; filename extensions and declared MIME types alone are not trusted.
- Files are stored privately through the configured Cloudinary storage provider.
- Document metadata is stored separately and linked to `MediaAsset`.
- Drivers can list and download only their own documents. Admins can list, review and download documents.
- Downloads, uploads and review decisions emit operational audit events.
- Reviewed evidence is immutable through this workflow; a correction is uploaded as a new document. No public storage URL is exposed.

## Reapplication

A rejected driver can submit a reasoned reapplication. In TEST mode, a reason is sufficient for controlled testing. In STRICT mode, at least one new pending document must have been uploaded after the previous profile review. The application returns to PENDING and remains offline/unavailable until Admin review.

## Release gates

Before enabling production driver operations:
1. Set `APP_STAGE=production` and `DRIVER_KYC_MODE=STRICT`.
2. Confirm production Cloudinary access is private and credentials are server-only.
3. Confirm required document types and expiry rules with the applicable legal/compliance owner.
4. Complete Admin document review and driver eligibility acceptance tests.
5. Keep payments and external payouts disabled until separately approved.
6. Run staging role, upload/download, dispatch, suspension and reapplication tests.

Never enable TEST mode against production data.
