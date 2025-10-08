const winston = require('winston');
const CustomLokiTransport = require('./customLokiTransport');
const { getContext } = require('../middleware/correlationContext');

// Create base Winston logger
const baseLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 7
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10485760, // 10MB
      maxFiles: 7
    })
  ]
});

// Add console transport in development
if (process.env.NODE_ENV !== 'production') {
  baseLogger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Add Grafana Loki transport if configured
if (process.env.LOKI_HOST && process.env.LOKI_USERNAME && process.env.LOKI_API_KEY) {
  try {
    // Extract hostname from LOKI_HOST (remove /loki/api/v1/push if present)
    const lokiHostClean = process.env.LOKI_HOST
      .replace('https://', '')
      .replace('http://', '')
      .replace('/loki/api/v1/push', '');

    const lokiTransport = new CustomLokiTransport({
      host: lokiHostClean,
      username: process.env.LOKI_USERNAME,
      apiKey: process.env.LOKI_API_KEY,
      labels: {
        job: 'immofrog-backend',
        level: 'info'
      },
      batchSize: 10,
      batchInterval: 5000
    });

    baseLogger.add(lokiTransport);

    lokiTransport.on('error', (err) => {
      console.error('❌ Loki transport error:', err.message);
    });

    lokiTransport.on('logged', (info) => {
      console.log('📤 Log batched for Loki:', info.message);
    });

    console.log('✅ Custom Loki transport enabled (using direct HTTPS)');
    console.log(`📡 Loki host: ${lokiHostClean}`);
    console.log(`👤 Loki user: ${process.env.LOKI_USERNAME}`);

    // Send a test log immediately
    setTimeout(() => {
      baseLogger.info('🚀 Custom Loki transport test message', {
        test: true,
        timestamp: new Date().toISOString()
      });
      console.log('📨 Test log sent to custom Loki transport');
    }, 2000);

  } catch (error) {
    console.error('❌ Failed to initialize Loki transport:', error.message);
    console.error('Full error:', error);
  }
} else {
  console.log('ℹ️  Grafana Loki not configured (set LOKI_HOST, LOKI_USERNAME, LOKI_API_KEY in .env)');
}

// Wrapper that auto-injects correlation context into every log
const contextLogger = {
  log: (level, message, meta = {}) => {
    const context = getContext();
    baseLogger.log(level, message, { ...context, ...meta });
  },

  info: (message, meta = {}) => {
    const context = getContext();
    baseLogger.info(message, { ...context, ...meta });
  },

  warn: (message, meta = {}) => {
    const context = getContext();
    baseLogger.warn(message, { ...context, ...meta });
  },

  error: (message, meta = {}) => {
    const context = getContext();
    baseLogger.error(message, { ...context, ...meta });
  },

  debug: (message, meta = {}) => {
    const context = getContext();
    baseLogger.debug(message, { ...context, ...meta });
  }
};

module.exports = contextLogger;
