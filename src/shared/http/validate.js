import { ValidationError } from "./app-error.js";

export function validate(schema, source = "body") {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) {
      next(new ValidationError("One or more request fields are invalid.", parsed.error.issues.map(({ path, message, code }) => ({ path: path.join("."), message, code }))));
      return;
    }

    req.validated = {
      ...(req.validated ?? {}),
      [source]: parsed.data,
    };

    // Express 5 exposes req.query through a getter. Keep validated query data
    // in the explicit request-validation bag instead of assigning req.query.
    if (source !== "query") req[source] = parsed.data;
    next();
  };
}
