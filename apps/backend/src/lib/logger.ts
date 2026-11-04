import { pino } from 'pino';
import { config, isProd } from '../config.js';

export const loggerOptions = {
  level: config.LOG_LEVEL,
  redact: ['req.headers.cookie', 'req.headers.authorization', '*.apiKey'],
  ...(isProd ? {} : { transport: { target: 'pino-pretty', options: { singleLine: true } } }),
};

export const logger = pino(loggerOptions);
export type Logger = typeof logger;
