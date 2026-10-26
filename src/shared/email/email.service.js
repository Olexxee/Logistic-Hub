import { env } from "../../config/env.js";
import { createResendEmailService } from "./resend-email.service.js";

export const emailService = env.EMAIL_PROVIDER === "resend"
  ? createResendEmailService({
      apiKey: env.RESEND_API_KEY,
      from: env.RESEND_FROM_EMAIL,
    })
  : createResendEmailService();
