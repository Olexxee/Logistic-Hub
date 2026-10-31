import { AsyncLocalStorage } from "node:async_hooks";

const auditContext = new AsyncLocalStorage();

export function runWithAuditContext(context, callback) {
  return auditContext.run({
    requestId: typeof context?.requestId === "string" ? context.requestId : null,
  }, callback);
}

export function getAuditContext() {
  return auditContext.getStore() ?? null;
}
