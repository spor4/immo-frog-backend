const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

const errorHandler = (err, req, res, next) => {
  const errorId = uuidv4();
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  logger.error('Error occurred:', {
    errorId,
    status,
    message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    headers: req.headers
  });

  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: err.message,
      details: err.errors || null,
      errorId,
      status: 400
    });
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication failed',
      errorId,
      status: 401
    });
  }

  if (err.code === 'ENOENT') {
    return res.status(404).json({
      error: 'Not Found',
      message: 'The requested resource was not found',
      errorId,
      status: 404
    });
  }

  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
    return res.status(503).json({
      error: 'Service Unavailable',
      message: 'External service is temporarily unavailable',
      errorId,
      status: 503
    });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Invalid JSON in request body',
      errorId,
      status: 400
    });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: 'Payload Too Large',
      message: 'Request body exceeds maximum size',
      errorId,
      status: 413
    });
  }

  if (err.source === 'claude-api') {
    const claudeStatus = err.status || 503;
    return res.status(claudeStatus).json({
      error: 'Claude API Error',
      message: err.message || 'Failed to process document with Claude AI',
      errorId,
      status: claudeStatus,
      details: err.details || null
    });
  }

  if (err.source === 'pdf-validation') {
    return res.status(422).json({
      error: 'PDF Validation Error',
      message: err.message || 'PDF file does not meet requirements',
      errorId,
      status: 422,
      details: err.details || null
    });
  }

  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(status).json({
    error: status === 500 ? 'Internal Server Error' : err.name || 'Error',
    message: isDevelopment ? message : (status === 500 ? 'An unexpected error occurred' : message),
    errorId,
    status,
    ...(isDevelopment && { stack: err.stack })
  });
};

module.exports = errorHandler;