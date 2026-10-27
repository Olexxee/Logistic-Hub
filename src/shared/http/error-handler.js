export function errorHandler(error, req, res, _next) {
  if (res.headersSent) return;
  const statusCode = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500;
  const isInternal = statusCode === 500;
  req.log?.[isInternal ? "error" : "warn"]({ err: error, code: error?.code }, "Request failed");
  const response = {
    success: false,
    error: {
      code: isInternal ? "INTERNAL_SERVER_ERROR" : (error?.code ?? "REQUEST_FAILED"),
      message: isInternal && process.env.NODE_ENV === "production" ? "An unexpected error occurred." : (error?.message ?? "Request failed."),
    },
  };
  if (!isInternal && error?.details !== undefined) response.error.details = error.details;
  if (statusCode === 429 && Number.isInteger(error?.retryAfterSeconds)) res.setHeader("Retry-After", String(error.retryAfterSeconds));
  res.status(statusCode).json(response);
}
