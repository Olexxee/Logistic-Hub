# Driver Availability and Location Policy (DRV-03)

## State semantics

- **Online**: driver has enabled the driver workspace session and may publish location.
- **Available**: driver is eligible to be considered for dispatch, subject to backend checks.
- **Busy**: driver has an active assignment and must not be available for another dispatch.
- **Offline**: driver is not eligible for new dispatch and cannot publish location.

Online and available are separate flags. A client-side toggle is never authoritative for dispatch eligibility.

## Eligibility checks

The backend must revalidate driver verification, KYC tier/mode, suspension, user account status, verified active vehicle, enabled coverage, service-zone availability, location freshness, and active assignment status at dispatch/reservation time.

Availability updates now reject a request to become available when an active assignment exists. Dispatch matching rejects location timestamps older than the configured freshness window or in the future.

## Location freshness configuration

- `DRIVER_LOCATION_MAX_AGE_SECONDS` defaults to **300 seconds (5 minutes)**.
- Allowed range: **30–900 seconds**.
- The same configured value governs dispatch candidate freshness and pickup-radius location validation.
- Lower values improve location confidence but can reduce dispatch supply when drivers have poor connectivity. Higher values increase the chance of matching against stale coordinates.
- Do not configure a large freshness window as a substitute for reliable location updates.

## Privacy and retention

- Location coordinates are operationally sensitive.
- Driver location must only be returned to roles and workflows that need it to execute an assignment.
- Admin oversight should prefer timestamps/status and avoid exposing raw coordinates by default.
- Location retention/deletion policy remains a separate compliance/release requirement; this change does not establish a legal retention period.

## Acceptance cases

1. Driver goes offline: location submission is denied.
2. Driver is suspended: availability and location updates are denied; dispatch excludes them.
3. Driver has an active assignment: attempting to become available is rejected.
4. Driver location is older than the configured freshness window: dispatch excludes the driver.
5. Driver location timestamp is in the future: dispatch excludes the driver.
6. Driver lacks verified active vehicle or active service coverage: cannot become available.
7. TEST_LIMITED driver: parcel-only coverage/dispatch restrictions continue to apply; passenger ride dispatch remains FULL-tier only.

## Release status

This policy and implementation require CI and staging verification. No production environment variables, migrations, or Render settings were changed by this work.
