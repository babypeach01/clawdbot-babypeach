const winston = require('winston');
const config = require('../config');

const logger = winston.createLogger({
  level: config.server.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) =>
      `[${timestamp}] ${level.toUpperCase()}: ${message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'app.log', maxsize: 5242880, maxFiles: 3 }),
  ],
});

module.exports = logger;
