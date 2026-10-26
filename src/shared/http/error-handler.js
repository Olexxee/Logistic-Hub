export function errorHandler(error, req, res, _next) {
  req.log?.error({ err: error }, "Unhandled request error");

  if (res.headersSent) {
    return;
  }

  const statusCode =
    Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 600
      ? error.statusCode
      : 500;

  res.status(statusCode).json({
    success: false,
    error: {
      code: statusCode === 500 ? "INTERNAL_SERVER_ERROR" : (error.code ?? "REQUEST_FAILED"),
      message:
        statusCode === 500 && process.env.NODE_ENV === "production"
          ? "An unexpected error occurred."
          : (error.message ?? "Request failed."),
    },
  });
}
