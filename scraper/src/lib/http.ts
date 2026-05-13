import axios, { AxiosInstance } from 'axios';
import winston from 'winston';

const DEFAULT_DELAY_MS = 2000;
const DEFAULT_USER_AGENT =
  'tww3-scraper/0.1 (https://github.com/Lukes-Git-Beginning/warhammer-tournament-platform)';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      ({ timestamp, level, message }) => `[${timestamp}] ${level}: ${message}`,
    ),
  ),
  transports: [new winston.transports.Console()],
});

export function createHttpClient(opts?: {
  delayMs?: number;
  userAgent?: string;
  baseURL?: string;
}): AxiosInstance {
  const delayMs = opts?.delayMs ?? DEFAULT_DELAY_MS;
  const userAgent = opts?.userAgent ?? DEFAULT_USER_AGENT;
  let lastRequestAt = 0;

  const instance = axios.create({
    baseURL: opts?.baseURL,
    headers: {
      'User-Agent': userAgent,
      Accept: 'text/html,application/xhtml+xml',
    },
    timeout: 15_000,
  });

  instance.interceptors.request.use(async (config) => {
    const now = Date.now();
    const elapsed = now - lastRequestAt;
    if (elapsed < delayMs && lastRequestAt > 0) {
      const wait = delayMs - elapsed;
      logger.debug(`Rate-limit: waiting ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
    lastRequestAt = Date.now();
    return config;
  });

  return instance;
}
