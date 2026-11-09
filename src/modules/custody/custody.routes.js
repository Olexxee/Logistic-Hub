import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { createCustodyService } from "./custody.service.js";
import { createCustodyController } from "./custody.controller.js";

const id = z.string().trim().min(1).max(128);
const evidenceSchema = z.array(z.object({
  uri: z.string().url().max(2048),
  type: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]).default("IMAGE"),
  capturedAt: z.string().datetime().optional(),
  note: z.string().trim().max(300).optional(),
}).strict()).max(10).optional();
const hubOperationsQuerySchema = z.object({
  direction: z.enum(["incoming", "outgoing"]).default("incoming"),
  status: z.enum(["PENDING_CONFIRMATION", "CONFIRMED", "REJECTED", "CANCELLED", "EXPIRED"]).optional(),
  hubPointId: id.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const hubIntakesQuerySchema = z.object({
  status: z.enum(["RECEIVED", "RELEASED", "EXCEPTION"]).default("RECEIVED"),
  hubPointId: id.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const hubDispatchQuerySchema = z.object({
  hubPointId: id.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const driverHubHandoverSchema = z.object({
  assignmentId: id,
  conditionAtRelease: z.string().trim().min(2).max(500),
  evidence: evidenceSchema,
}).strict();
const createHubHandoverSchema = z.object({
  hubPointId: id,
  deliveryLegId: id,
  toPartyType: z.enum(["DRIVER", "TRANSPORT_PARTNER"]),
  toPartyId: id,
  conditionAtRelease: z.string().trim().min(2).max(500),
  evidence: evidenceSchema,
}).strict();
const hubExceptionSchema = z.object({
  hubPointId: id,
  deliveryLegId: id,
  type: z.enum(["DAMAGED_PARCEL", "MISSING_PARCEL", "FAILED_DELIVERY", "ROUTE_DISRUPTION", "OTHER"]),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).default("NORMAL"),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(5).max(2000),
  evidence: evidenceSchema,
}).strict();
const operatorSchema = z.object({
  userId: id,
  role: z.enum(["MANAGER", "OPERATOR"]).default("OPERATOR"),
  reason: z.string().trim().min(5).max(1000),
}).strict();
const hubStaffSchema = z.object({
  userId: id,
  reason: z.string().trim().min(5).max(1000),
}).strict();
const operatorStatusSchema = z.object({
  isActive: z.boolean(),
  reason: z.string().trim().min(5).max(1000),
}).strict();
const dispatchPermissionSchema = z.object({
  canDispatch: z.boolean(),
  reason: z.string().trim().min(5).max(1000),
}).strict();
const operatorRoleSchema = z.object({
  role: z.enum(["MANAGER", "OPERATOR"]),
  reason: z.string().trim().min(5).max(1000),
}).strict();
const hubOperatorsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  isActive: z.enum(["true", "false"]).transform(value => value === "true").optional(),
}).strict();
const phoneVerificationSchema = z.object({
  verified: z.boolean(),
  verificationMethod: z.enum(["CALLBACK", "IN_PERSON", "DOCUMENT_REVIEW", "ADMIN_REVOCATION"]),
  reason: z.string().trim().min(5).max(1000),
}).strict().refine(value => value.verified
  ? value.verificationMethod !== "ADMIN_REVOCATION"
  : value.verificationMethod === "ADMIN_REVOCATION", {
  message: "Verification method must match the requested verification action.",
});
const createHandoverSchema = z.object({
  parcelBookingId: id,
  deliveryLegId: id,
  hubPointId: id.optional(),
  fromPartyType: z.enum(["SENDER", "DRIVER", "HUB", "TRANSPORT_PARTNER", "RECIPIENT"]),
  fromPartyId: id,
  toPartyType: z.enum(["SENDER", "DRIVER", "HUB", "TRANSPORT_PARTNER", "RECIPIENT"]),
  toPartyId: id,
  conditionAtRelease: z.string().trim().min(2).max(500),
  evidence: evidenceSchema,
}).strict();
const handoverDecisionSchema = z.object({
  conditionAtReceipt: z.string().trim().min(2).max(500).optional(),
  weightGrams: z.number().int().positive().max(100000000).optional(),
  lengthMm: z.number().int().positive().max(1000000).optional(),
  widthMm: z.number().int().positive().max(1000000).optional(),
  heightMm: z.number().int().positive().max(1000000).optional(),
  evidence: evidenceSchema,
  rejectReason: z.string().trim().min(3).max(1000).optional(),
}).strict().refine(value => !(value.rejectReason && !value.conditionAtReceipt && !value.evidence), {
  message: "A rejection must include receipt condition or evidence.",
}).refine(value => {
  const any = [value.lengthMm, value.widthMm, value.heightMm].some(item => item !== undefined);
  const all = [value.lengthMm, value.widthMm, value.heightMm].every(item => item !== undefined);
  return !any || all;
}, { message: "Provide all parcel dimensions or none." });

const adminCustodyQuerySchema = z.object({
  status: z.enum(["PENDING_CONFIRMATION", "CONFIRMED", "REJECTED", "CANCELLED", "EXPIRED"]).optional(),
  hubPointId: id.optional(),
  q: z.string().trim().min(2).max(64).optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const adminIntakesQuerySchema = z.object({
  status: z.enum(["RECEIVED", "RELEASED", "EXCEPTION"]).optional(),
  hubPointId: id.optional(),
  q: z.string().trim().min(2).max(64).optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

const adminHubRecoveriesQuerySchema = z.object({
  status: z.enum(["PENDING_RECEIPT", "CONFIRMED", "CANCELLED"]).optional(),
  hubPointId: id.optional(),
  cursor: id.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
const initiateHubRecoverySchema = z.object({
  hubPointId: id,
  reason: z.string().trim().min(5).max(1000),
}).strict();
const receiveHubRecoverySchema = z.object({
  conditionAtReceipt: z.string().trim().min(2).max(500),
  weightGrams: z.number().int().positive().max(100000000),
  lengthMm: z.number().int().positive().max(1000000).optional(),
  widthMm: z.number().int().positive().max(1000000).optional(),
  heightMm: z.number().int().positive().max(1000000).optional(),
  evidence: evidenceSchema,
}).strict().refine(value => {
  const any = [value.lengthMm, value.widthMm, value.heightMm].some(item => item !== undefined);
  const all = [value.lengthMm, value.widthMm, value.heightMm].every(item => item !== undefined);
  return !any || all;
}, { message: "Provide all parcel dimensions or none." });
const cancelHubRecoverySchema = z.object({
  reason: z.string().trim().min(5).max(1000),
}).strict();

function validate(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: {
      code: "VALIDATION_ERROR", message: "One or more fields are invalid.",
      details: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
    } });
    req.body = parsed.data;
    return next();
  };
}
function validateQuery(schema) {
  return (req, res, next) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, error: {
      code: "VALIDATION_ERROR", message: "One or more query parameters are invalid.",
      details: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
    } });
    req.validatedQuery = parsed.data;
    return next();
  };
}

function validateParams(req, res, next) {
  if (Object.values(req.params).some(value => !id.safeParse(value).success)) {
    return res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "A valid identifier is required." } });
  }
  return next();
}

export function createCustodyRouter({ prismaClient = prisma, authMiddleware = requireAuth, roleMiddleware = requireRole } = {}) {
  const router = Router();
  const service = createCustodyService({ prismaClient });
  const controller = createCustodyController(service);
  const admin = roleMiddleware("ADMIN");

  router.get("/admin/custody-handovers", authMiddleware, admin, validateQuery(adminCustodyQuerySchema), asyncWrapper(controller.listAdminCustodyHandovers));
  router.get("/admin/hub-intakes", authMiddleware, admin, validateQuery(adminIntakesQuerySchema), asyncWrapper(controller.listAdminHubIntakes));

  router.get("/admin/assignments/hub-recoveries", authMiddleware, admin, validateQuery(adminHubRecoveriesQuerySchema), asyncWrapper(controller.listAdminHubRecoveries));
  router.post("/admin/assignments/:assignmentId/hub-recoveries", authMiddleware, admin, validateParams, validate(initiateHubRecoverySchema), asyncWrapper(controller.initiateAdminHubRecovery));
  router.post("/admin/hub-recoveries/:recoveryId/cancel", authMiddleware, admin, validateParams, validate(cancelHubRecoverySchema), asyncWrapper(controller.cancelAdminHubRecovery));
  router.post("/hub-operations/hub-recoveries/:recoveryId/receive", authMiddleware, validateParams, validate(receiveHubRecoverySchema), asyncWrapper(controller.receiveAdminHubRecovery));
  router.patch("/admin/users/:userId/phone-verification", authMiddleware, admin, validateParams, validate(phoneVerificationSchema), asyncWrapper(controller.setRecipientPhoneVerification));
  router.get("/admin/hub-points/:hubPointId/operators", authMiddleware, admin, validateParams, (req, res, next) => {
    const parsed = hubOperatorsQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, error: {
      code: "VALIDATION_ERROR", message: "One or more query parameters are invalid.",
      details: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
    } });
    req.validatedQuery = parsed.data;
    return next();
  }, asyncWrapper(controller.listHubOperators));
  router.post("/admin/hub-points/:hubPointId/operators", authMiddleware, admin, validateParams, validate(operatorSchema), asyncWrapper(controller.addHubOperator));
  router.patch("/admin/hub-points/:hubPointId/operators/:operatorId", authMiddleware, admin, validateParams, validate(operatorStatusSchema), asyncWrapper(controller.setHubOperatorStatus));
  router.patch("/admin/hub-points/:hubPointId/operators/:operatorId/role", authMiddleware, admin, validateParams, validate(operatorRoleSchema), asyncWrapper(controller.updateHubOperatorRole));
  router.patch("/admin/hub-points/:hubPointId/operators/:operatorId/dispatch-permission", authMiddleware, admin, validateParams, validate(dispatchPermissionSchema), asyncWrapper(controller.setHubOperatorDispatchPermission));
  router.get("/hub-operations/hubs/:hubPointId/operators", authMiddleware, validateParams, (req, res, next) => {
    const parsed = hubOperatorsQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, error: {
      code: "VALIDATION_ERROR", message: "One or more query parameters are invalid.",
      details: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
    } });
    req.validatedQuery = parsed.data;
    return next();
  }, asyncWrapper(controller.listHubOperatorsForManager));
  router.post("/hub-operations/hubs/:hubPointId/operators", authMiddleware, validateParams, validate(hubStaffSchema), asyncWrapper(controller.addHubStaff));
  router.get("/hub-operations/intakes", authMiddleware, (req, res, next) => {
    const parsed = hubIntakesQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, error: {
      code: "VALIDATION_ERROR", message: "One or more query parameters are invalid.",
      details: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
    } });
    req.validatedQuery = parsed.data;
    return next();
  }, asyncWrapper(controller.listHubIntakes));
  router.get("/hub-operations/handovers", authMiddleware, (req, res, next) => {
    const parsed = hubOperationsQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, error: {
      code: "VALIDATION_ERROR", message: "One or more query parameters are invalid.",
      details: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
    } });
    req.validatedQuery = parsed.data;
    return next();
  }, asyncWrapper(controller.listHubHandovers));
  router.get("/hub-operations/dispatchable", authMiddleware, (req, res, next) => {
    const parsed = hubDispatchQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, error: {
      code: "VALIDATION_ERROR", message: "One or more query parameters are invalid.",
      details: parsed.error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })),
    } });
    req.validatedQuery = parsed.data;
    return next();
  }, asyncWrapper(controller.listHubDispatchable));
  router.post("/driver/hub-handovers", authMiddleware, validate(driverHubHandoverSchema), asyncWrapper(controller.createDriverHubHandover));
  router.post("/hub-operations/handovers", authMiddleware, validate(createHubHandoverSchema), asyncWrapper(controller.createHubHandover));
  router.post("/hub-operations/handovers/:handoverId/decision", authMiddleware, validateParams, validate(handoverDecisionSchema), asyncWrapper(controller.decideHubHandover));
  router.post("/hub-operations/cases", authMiddleware, validate(hubExceptionSchema), asyncWrapper(controller.reportHubException));

  router.get("/custody/handovers/mine", authMiddleware, asyncWrapper(controller.listMyHandovers));
  router.post("/custody/handovers", authMiddleware, validate(createHandoverSchema), asyncWrapper(controller.createHandover));
  router.post("/custody/handovers/:handoverId/decision", authMiddleware, validateParams, validate(handoverDecisionSchema), asyncWrapper(controller.confirmHandover));

  return router;
}
export const custodyRouter = createCustodyRouter();
