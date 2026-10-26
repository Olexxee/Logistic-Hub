export function asyncWrapper(handler) {
  return function wrappedAsyncHandler(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
