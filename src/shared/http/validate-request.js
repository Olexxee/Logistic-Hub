import { ValidationError } from "./app-error.js";

export function validateRequest(schema, source = "body") {
  return function validate(req, _res, next) {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      return next(new ValidationError("One or more fields are invalid.", parsed.error.issues.map(({ path, message }) => ({
        path: path.join("."),
        message,
      }))));
    }
    req.validated ??= {};
    req.validated[source] = parsed.data;
    return next();
  };
}
