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
  constructor(message = "One or more fields are invalid.", details) { super(message, { statusCode: 400, code: "VALIDATION_ERROR", details }); }
}
export class AuthenticationError extends AppError {
  constructor(message = "Authentication is required.", code = "UNAUTHENTICATED") { super(message, { statusCode: 401, code }); }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action.", code = "FORBIDDEN") { super(message, { statusCode: 403, code }); }
}
export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found.", code = "NOT_FOUND") { super(message, { statusCode: 404, code }); }
}
export class ConflictError extends AppError {
  constructor(message = "The request conflicts with the current resource state.", code = "CONFLICT") { super(message, { statusCode: 409, code }); }
}
export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests. Please try again later.", retryAfterSeconds = 60) { super(message, { statusCode: 429, code: "RATE_LIMITED", details: { retryAfterSeconds } }); this.retryAfterSeconds = retryAfterSeconds; }
}
export class ServiceUnavailableError extends AppError {
  constructor(message = "This service is temporarily unavailable.", code = "SERVICE_UNAVAILABLE") { super(message, { statusCode: 503, code }); }
}
