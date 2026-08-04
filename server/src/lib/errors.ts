import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';
import { config } from '../config.js';

/** An error with an HTTP status that is safe to surface to the client. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, message: string, code = 'error', details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new AppError(400, message, 'bad_request', details);
  }
  static unauthorized(message = 'Authentication required') {
    return new AppError(401, message, 'unauthorized');
  }
  static forbidden(message = 'Not allowed') {
    return new AppError(403, message, 'forbidden');
  }
  static notFound(message = 'Not found') {
    return new AppError(404, message, 'not_found');
  }
  static conflict(message: string) {
    return new AppError(409, message, 'conflict');
  }
  static upstream(message: string, details?: unknown) {
    return new AppError(502, message, 'upstream_error', details);
  }
}

/** Wraps an async handler so rejected promises reach the error middleware. */
export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Endpoint not found', code: 'not_found' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      code: 'validation_error',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.status >= 500) logger.error(`${err.code}: ${err.message}`, err.details ?? '');
    res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    return;
  }

  const message = err instanceof Error ? err.message : 'Unexpected server error';
  logger.error('unhandled error:', err);
  res.status(500).json({
    error: config.isProduction ? 'Internal server error' : message,
    code: 'internal_error',
  });
}
