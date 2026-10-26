import { AppError } from "./app-error.js";

export function errorHandler(error, req, res, _next) {
  req.log?.error({ err: error }, "Request failed");
  if (res.headersSent) return;

  const isAppError = error instanceof AppError;
  const statusCode = isAppError
    ? error.statusCode
    : Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : error.code === "P2002" ? 409
        : error.code === "P2025" ? 404
          : 500;

  const knownPrismaError = error.code === "P2002" || error.code === "P2025";
  const message = isAppError || knownPrismaError || (statusCode < 500 && typeof error.message === "string")
    ? (knownPrismaError ? "The request conflicts with the current resource state." : error.message)
    : "An unexpected error occurred.";

  const payload = {
    success: false,
    error: {
      code: isAppError ? error.code : knownPrismaError ? (error.code === "P2002" ? "CONFLICT" : "NOT_FOUND") : statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : (error.code ?? "REQUEST_FAILED"),
      message,
      ...(isAppError && error.details !== undefined ? { details: error.details } : {}),
    },
  };
  res.status(statusCode).json(payload);
}
