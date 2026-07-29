// ===========================================
// Error Handler Middleware
// ===========================================

import type { Request, Response, NextFunction } from 'express';
import { AppError, isAppError, isOperationalError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    stack?: string;
  };
}

function getRequestBodyForLogging(req: Request): unknown {
  if (
    !req.path.endsWith('/sso/exchange') ||
    !req.body ||
    typeof req.body !== 'object' ||
    Array.isArray(req.body)
  ) {
    return req.body;
  }

  const body = req.body as Record<string, unknown>;

  return {
    ...body,
    ...(typeof body['encryptedData'] === 'string' ? { encryptedData: '[redacted]' } : {}),
    ...(typeof body['ssoData'] === 'string' ? { ssoData: '[redacted]' } : {}),
  };
}

/**
 * Global error handler
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log the error
  logger.error(
    {
      err,
      path: req.path,
      method: req.method,
      body: getRequestBodyForLogging(req),
      query: req.query,
      userId: req.user?.id,
      organizationId: req.user?.organizationId,
    },
    'Request error'
  );

  // Handle known operational errors
  if (isAppError(err)) {
    const response: ErrorResponse = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    };

    if (config.nodeEnv === 'development') {
      response.error.stack = err.stack;
    }

    res.status(err.statusCode).json(response);
    return;
  }

  // Handle unexpected errors
  const statusCode = 500;
  const response: ErrorResponse = {
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: config.nodeEnv === 'production'
        ? 'An unexpected error occurred'
        : err.message,
    },
  };

  if (config.nodeEnv === 'development') {
    response.error.stack = err.stack;
  }

  res.status(statusCode).json(response);
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  });
}

/**
 * Async handler wrapper - catches async errors
 */
export function asyncHandler<T>(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<T>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
