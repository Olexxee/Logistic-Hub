export function errorHandler(error, req, res, _next) {
  if (res.headersSent) return;
  const statusCode =
    Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500;
  const known = statusCode < 500 || Boolean(error.isOperational);
  req.log?.[statusCode >= 500 ? "error" : "warn"]?.({
    code: error.code ?? "INTERNAL_SERVER_ERROR",
    statusCode,
    ...(statusCode >= 500 ? { err: error } : {}),
  }, "Request failed");

  res.status(statusCode).json({
    success: false,
    error: {
      code: known ? (error.code ?? "REQUEST_FAILED") : "INTERNAL_SERVER_ERROR",
      message: known || process.env.NODE_ENV !== "production"
        ? (error.message ?? "Request failed.")
        : "An unexpected error occurred.",
      ...(known && error.details !== undefined ? { details: error.details } : {}),
    },
  });
}
