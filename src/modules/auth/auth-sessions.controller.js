import { asyncWrapper } from "../../shared/http/async-wrapper.js";

export function createAuthSessionsController({ service }) {
  return {
    refresh: asyncWrapper(async (req, res) => {
      const result = await service.refresh(req.body?.refreshToken);
      res.status(200).json({ success: true, data: result });
    }),
    revoke: asyncWrapper(async (req, res) => {
      const result = await service.revoke({ refreshToken: req.body?.refreshToken, userId: req.user.id });
      res.status(200).json({ success: true, data: result });
    }),
  };
}
