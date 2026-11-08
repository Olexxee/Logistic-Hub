import { z } from "zod";
import { asyncWrapper } from "../../shared/http/async-wrapper.js";
import { createDriverDocumentsService } from "./driver-documents.service.js";

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  reviewStatus: z.enum(["PENDING","APPROVED","REJECTED"]).optional(),
  driverProfileId: z.string().trim().min(1).max(128).optional(),
  vehicleId: z.string().trim().min(1).max(128).optional(),
}).strict();
const reviewSchema = z.object({
  reviewStatus: z.enum(["APPROVED","REJECTED"]),
  reason: z.string().trim().min(10).max(500),
}).strict();

function invalid(res, issues) {
  return res.status(400).json({ success: false, error: {
    code: "VALIDATION_ERROR", message: "One or more request fields are invalid.",
    details: issues.map(({ path, message }) => ({ path: path.join("."), message })),
  } });
}

export function createDriverDocumentsController({ prismaClient, service }) {
  const documents = service ?? createDriverDocumentsService({ prismaClient });
  return {
    listMine: asyncWrapper(async (req,res) => res.status(200).json({ success:true, data: await documents.listMine({ user:req.user }) })),
    uploadMine: asyncWrapper(async (req,res) => {
      const result = await documents.uploadMine({
        user:req.user, buffer:req.body, mimeType:req.headers["x-file-content-type"],
        originalName:req.headers["x-file-name"], documentType:req.headers["x-document-type"],
        vehicleId:req.headers["x-vehicle-id"] || undefined,
        expiresAt:req.headers["x-document-expires-at"] || undefined,
      });
      return res.status(201).json({ success:true, data:result });
    }),
    listAdmin: asyncWrapper(async (req,res) => {
      const parsed = listSchema.safeParse(req.query);
      if (!parsed.success) return invalid(res,parsed.error.issues);
      return res.status(200).json({ success:true, data:await documents.listForAdmin(parsed.data) });
    }),
    reviewAdmin: asyncWrapper(async (req,res) => {
      const id = z.string().trim().min(1).max(128).safeParse(req.params.documentId);
      const parsed = reviewSchema.safeParse(req.body);
      if (!id.success || !parsed.success) return invalid(res,[...(id.success?[]:id.error.issues),...(parsed.success?[]:parsed.error.issues)]);
      const result = await documents.reviewDocument({ documentId:id.data, ...parsed.data, actorUserId:req.user.id });
      if (!result) return res.status(404).json({ success:false, error:{ code:"NOT_FOUND", message:"Driver verification document not found." } });
      return res.status(200).json({ success:true, data:result });
    }),
    download: asyncWrapper(async (req,res) => {
      const id = z.string().trim().min(1).max(128).safeParse(req.params.documentId);
      if (!id.success) return invalid(res,id.error.issues);
      const file = await documents.downloadDocument({ documentId:id.data, user:req.user });
      const safeName = file.originalName.replace(/["\\\r\n]/g,"_");
      res.setHeader("Content-Type",file.mimeType);
      res.setHeader("Content-Length",String(file.buffer.length));
      res.setHeader("Content-Disposition",`attachment; filename="${safeName}"`);
      res.setHeader("X-Content-Type-Options","nosniff");
      res.setHeader("Cache-Control","private, no-store");
      return res.status(200).send(file.buffer);
    }),
  };
}
