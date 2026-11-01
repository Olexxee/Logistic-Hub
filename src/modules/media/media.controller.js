import { asyncWrapper } from "../../shared/http/async-wrapper.js";

export function createMediaController(service) {
  return {
    list: asyncWrapper(async (req, res) => res.status(200).json({
      success: true,
      data: await service.listTicketAttachments({ ticketId: req.params.ticketId, user: req.user }),
    })),
    upload: asyncWrapper(async (req, res) => res.status(201).json({
      success: true,
      data: await service.uploadTicketAttachment({
        ticketId: req.params.ticketId,
        user: req.user,
        buffer: req.body,
        mimeType: req.headers["x-file-content-type"],
        originalName: req.headers["x-file-name"],
      }),
    })),
    download: asyncWrapper(async (req, res) => {
      const file = await service.downloadTicketAttachment({
        ticketId: req.params.ticketId,
        attachmentId: req.params.attachmentId,
        user: req.user,
      });
      const safeName = file.originalName.replace(/["\\\r\n]/g, "_");
      res.setHeader("Content-Type", file.mimeType);
      res.setHeader("Content-Length", String(file.buffer.length));
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.status(200).send(file.buffer);
    }),
  };
}
