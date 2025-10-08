const { AsyncLocalStorage } = require('async_hooks');
const { v4: uuidv4 } = require('uuid');

const asyncLocalStorage = new AsyncLocalStorage();

function correlationMiddleware(req, res, next) {
  const requestId = req.headers['x-request-id'] ||
                    req.headers['x-correlation-id'] ||
                    uuidv4();

  const context = {
    requestId,
    startTime: Date.now(),
    endpoint: req.path,
    method: req.method,
    userAgent: req.headers['user-agent']
  };

  asyncLocalStorage.run(context, () => {
    res.setHeader('X-Request-ID', requestId);
    res.setHeader('X-Correlation-ID', requestId);
    next();
  });
}

function getContext() {
  return asyncLocalStorage.getStore() || {};
}

module.exports = {
  correlationMiddleware,
  getContext,
  asyncLocalStorage
};
