const winston = require('winston');
const path = require('path');

const logLevel = process.env.LOG_LEVEL || 'info';
const nodeEnv = process.env.NODE_ENV || 'development';

const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;

    if (Object.keys(metadata).length > 0) {
      if (metadata.stack) {
        msg += `\n${metadata.stack}`;
      } else if (nodeEnv === 'development') {
        const metaString = JSON.stringify(metadata, null, 2);
        if (metaString !== '{}') {
          msg += ` ${metaString}`;
        }
      }
    }

    return msg;
  })
);

const transports = [
  new winston.transports.Console({
    format: consoleFormat,
    level: nodeEnv === 'development' ? 'debug' : 'info'
  })
];

if (nodeEnv === 'production') {
  transports.push(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: logFormat,
      maxsize: 10485760,
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: logFormat,
      maxsize: 10485760,
      maxFiles: 10
    })
  );
}

const logger = winston.createLogger({
  level: logLevel,
  format: logFormat,
  transports: transports,
  exitOnError: false
});

logger.stream = {
  write: (message) => {
    logger.info(message.trim());
  }
};

if (nodeEnv !== 'test') {
  logger.info('Logger initialized', {
    logLevel,
    environment: nodeEnv,
    transports: transports.length
  });
}

module.exports = logger;