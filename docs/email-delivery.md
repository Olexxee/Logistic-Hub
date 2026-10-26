# Transactional Email

## Provider

The backend supports Resend through the provider-neutral email service. The implementation uses Node's built-in fetch; no provider SDK or API key is bundled into the repository.

Set these environment variables in the deployment environment:

- EMAIL_PROVIDER=resend
- RESEND_API_KEY to the secret API key from Resend
- RESEND_FROM_EMAIL to a sender address on a domain verified in Resend
- APP_BASE_URL to the public web app URL used in links

Keep EMAIL_PROVIDER=none until the sender domain is verified and deployment secrets are configured. Never commit real credentials.

## Usage

Import emailService from src/shared/email/email.service.js and call send({ to, subject, html, text, idempotencyKey }). Use a stable idempotency key for retries of the same logical message. Do not send passwords, raw verification tokens, payment secrets, or sensitive provider payloads to application logs.

Email delivery failures must not be silently interpreted as success. For non-critical notifications, record the in-app notification and handle email delivery as a retryable side effect. For security-critical verification flows, only report email dispatch as successful when the provider accepts the request.

## Current status

This adds the Resend transport and configuration contract. Registration, verification, password reset, booking lifecycle notifications, and payment notifications must call this service as their respective workflows are implemented. No email is sent until EMAIL_PROVIDER=resend is explicitly configured.
