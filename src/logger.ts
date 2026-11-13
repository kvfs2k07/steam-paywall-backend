// src/logger.ts
// Apache-2.0 License — see LICENSE

import winston from 'winston';
import 'winston-daily-rotate-file';

const { combine, timestamp, printf, colorize } = winston.format;

const lineFormat = printf(({ timestamp: ts, level, message }) =>
  `${ts} [${String(level).toUpperCase()}]: ${message}`,
);

const logger = winston.createLogger({
  level: process.env['LOG_LEVEL'] ?? 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    lineFormat,
  ),
  transports: [
    new (winston.transports as any).DailyRotateFile({
      filename: 'logs/app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true,
    }),
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        lineFormat,
      ),
    }),
  ],
});

export default logger;
