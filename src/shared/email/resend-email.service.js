const RESEND_EMAILS_URL = "https://api.resend.com/emails";

export function createResendEmailService({ apiKey, from, fetchImpl = fetch } = {}) {
  const configured = Boolean(apiKey?.trim() && from?.trim());

  return Object.freeze({
    configured,

    async send({ to, subject, html, text, idempotencyKey, replyTo, tags } = {}) {
      if (!configured) {
        const error = new Error("Transactional email is not configured.");
        error.code = "EMAIL_NOT_CONFIGURED";
        throw error;
      }

      const recipients = Array.isArray(to) ? to : [to];
      if (!recipients.length || recipients.some((address) => typeof address !== "string" || !address.trim())) {
        throw new TypeError("At least one valid email recipient is required.");
      }
      if (typeof subject !== "string" || !subject.trim()) {
        throw new TypeError("An email subject is required.");
      }
      if (!html && !text) {
        throw new TypeError("Email html or text content is required.");
      }

      const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      };
      if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

      const payload = {
        from,
        to: recipients,
        subject: subject.trim(),
        ...(html ? { html } : {}),
        ...(text ? { text } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(Array.isArray(tags) && tags.length ? { tags } : {}),
      };

      let response;
      try {
        response = await fetchImpl(RESEND_EMAILS_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
      } catch {
        const error = new Error("Transactional email provider could not be reached.");
        error.code = "EMAIL_PROVIDER_UNAVAILABLE";
        throw error;
      }

      let result = {};
      try {
        result = await response.json();
      } catch {
        // Provider errors are deliberately sanitized below.
      }

      if (!response.ok) {
        const error = new Error("Transactional email provider rejected the request.");
        error.code = "EMAIL_DELIVERY_FAILED";
        error.status = response.status;
        throw error;
      }

      return { id: typeof result.id === "string" ? result.id : null, accepted: true };
    },
  });
}
