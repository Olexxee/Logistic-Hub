import { ValidationError } from "./app-error.js";

export function validateRequest(schema, source = "body") {
  return function requestValidator(req, _res, next) {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      const details = parsed.error.issues.map(({ path, message }) => ({
        path: path.join("."),
        message,
      }));
      return next(new ValidationError("One or more fields are invalid.", details));
    }
    req.validated ??= {};
    req.validated[source] = parsed.data;
    return next();
  };
}
