import { ValidationError } from "./app-error.js";

export function validate(schema, source = "body") {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      next(new ValidationError("One or more fields are invalid.", parsed.error.issues.map(({ path, message, code }) => ({ path: path.join("."), message, code }))));
      return;
    }
    req[source] = parsed.data;
    next();
  };
}
