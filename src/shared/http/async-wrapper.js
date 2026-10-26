export function asyncWrapper(handler) {
  return function wrappedAsyncHandler(req, res, next) {
    Promise.resolve().then(() => handler(req, res, next)).catch(next);
  };
}
