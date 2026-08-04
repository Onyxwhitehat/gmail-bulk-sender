import { config } from '../config.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
type Level = keyof typeof LEVELS;

const threshold = LEVELS[(config.logLevel as Level) in LEVELS ? (config.logLevel as Level) : 'info'];

function emit(level: Level, message: unknown, ...rest: unknown[]): void {
  if (LEVELS[level] > threshold) return;
  const stamp = new Date().toISOString();
  const line = `${stamp} ${level.toUpperCase().padEnd(5)} ${typeof message === 'string' ? message : JSON.stringify(message)}`;
  const stream = level === 'error' || level === 'warn' ? console.error : console.log;
  stream(line, ...rest);
}

export const logger = {
  error: (message: unknown, ...rest: unknown[]) => emit('error', message, ...rest),
  warn: (message: unknown, ...rest: unknown[]) => emit('warn', message, ...rest),
  info: (message: unknown, ...rest: unknown[]) => emit('info', message, ...rest),
  debug: (message: unknown, ...rest: unknown[]) => emit('debug', message, ...rest),
};
