export class AppError extends Error {
  constructor(message, { statusCode = 500, code = "INTERNAL_SERVER_ERROR", details, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}
export class ValidationError extends AppError {
  constructor(message = "One or more fields are invalid.", details) {
    super(message, { statusCode: 400, code: "VALIDATION_ERROR", details });
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication is required.") { super(message, { statusCode: 401, code: "UNAUTHORIZED" }); }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.") { super(message, { statusCode: 403, code: "FORBIDDEN" }); }
}
export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found.") { super(message, { statusCode: 404, code: "NOT_FOUND" }); }
}
export class ConflictError extends AppError {
  constructor(message = "The request conflicts with the current resource state.", code = "CONFLICT") { super(message, { statusCode: 409, code }); }
}
export class RateLimitError extends AppError {
  constructor(message = "Too many requests. Please try again later.") { super(message, { statusCode: 429, code: "RATE_LIMITED" }); }
}
export class ServiceUnavailableError extends AppError {
  constructor(message = "The service is temporarily unavailable.") { super(message, { statusCode: 503, code: "SERVICE_UNAVAILABLE" }); }
}
