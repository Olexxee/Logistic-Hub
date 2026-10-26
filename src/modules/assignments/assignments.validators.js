import { z } from "zod";
import { ValidationError } from "../../shared/http/app-error.js";

const idSchema = z.string().trim().min(1).max(128);
const verificationSchema = z.object({ code: z.string().regex(/^[0-9]{8}$/) }).strict();

export function validateAssignmentId(req, _res, next) {
  const parsed = idSchema.safeParse(req.params.assignmentId);
  if (!parsed.success) return next(new ValidationError("The assignment ID is invalid."));
  req.validated = { ...(req.validated ?? {}), params: { assignmentId: parsed.data } };
  return next();
}
export function validateVerificationCode(req, _res, next) {
  const parsed = verificationSchema.safeParse(req.body);
  if (!parsed.success) return next(new ValidationError("The verification code is invalid.", parsed.error.issues.map(({ path, message }) => ({ path: path.join("."), message }))));
  req.validated = { ...(req.validated ?? {}), body: parsed.data };
  return next();
}
