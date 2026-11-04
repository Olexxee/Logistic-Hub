import { Router, raw } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/auth.middleware.js";
import { validate } from "../../shared/http/validate.js";
import { createDriverDocumentsController } from "./driver-documents.controller.js";

export function createDriverDocumentsRouter({ prismaClient, authMiddleware = requireAuth, roleMiddleware = requireRole, service } = {}) {
  const router = Router();
  const controller = createDriverDocumentsController({ prismaClient, service });
  const idParams = z.object({ documentId:z.string().trim().min(1).max(128) });
  router.get("/me/documents",authMiddleware,controller.listMine);
  router.post("/me/documents",authMiddleware,(req,res,next)=>{
    if(req.headers["content-type"]?.split(";")[0].trim()!=="application/octet-stream") {
      return res.status(415).json({success:false,error:{code:"UNSUPPORTED_MEDIA_TYPE",message:"Upload as application/octet-stream with x-file-content-type, x-file-name and x-document-type headers."}});
    }
    return next();
  },raw({type:"application/octet-stream",limit:"10mb"}),controller.uploadMine);
  router.get("/me/documents/:documentId/download",authMiddleware,validate(idParams,"params"),controller.download);
  router.use("/admin/documents",authMiddleware,roleMiddleware("ADMIN"));
  router.get("/admin/documents",controller.listAdmin);
  router.patch("/admin/documents/:documentId/review",controller.reviewAdmin);
  router.get("/admin/documents/:documentId/download",validate(idParams,"params"),controller.download);
  return router;
}
