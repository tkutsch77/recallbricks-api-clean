/**
 * Enhanced Error Handling
 *
 * Consistent error responses with error codes, request IDs, and stack traces
 */

export enum ErrorCode {
  // Authentication & Authorization (1000-1099)
  INVALID_API_KEY = 'INVALID_API_KEY',
  MISSING_API_KEY = 'MISSING_API_KEY',
  UNAUTHORIZED = 'UNAUTHORIZED',

  // Validation (1100-1199)
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_TEXT_LENGTH = 'INVALID_TEXT_LENGTH',

  // Rate Limiting (1200-1299)
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  // Database (1300-1399)
  DATABASE_ERROR = 'DATABASE_ERROR',
  DATABASE_CONNECTION_FAILED = 'DATABASE_CONNECTION_FAILED',
  QUERY_FAILED = 'QUERY_FAILED',

  // Not Found (1400-1499)
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  ROUTE_NOT_FOUND = 'ROUTE_NOT_FOUND',

  // Server Errors (1500-1599)
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  CIRCUIT_BREAKER_OPEN = 'CIRCUIT_BREAKER_OPEN',
}

export class APIError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'APIError';
    Object.setPrototypeOf(this, APIError.prototype);
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

export interface ErrorResponse {
  error: {
    code: ErrorCode | string;
    message: string;
    details?: Record<string, any>;
    requestId?: string;
    timestamp: string;
  };
  stack?: string;
}

export function createErrorResponse(
  error: Error | APIError,
  requestId?: string,
  includeStack: boolean = false
): ErrorResponse {
  const timestamp = new Date().toISOString();

  if (error instanceof APIError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId,
        timestamp,
      },
      ...(includeStack && { stack: error.stack }),
    };
  }

  return {
    error: {
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: error.message || 'An unexpected error occurred',
      requestId,
      timestamp,
    },
    ...(includeStack && { stack: error.stack }),
  };
}

// Common error factory functions
export const Errors = {
  invalidApiKey: () =>
    new APIError(ErrorCode.INVALID_API_KEY, 'Invalid API key', 401),

  missingApiKey: () =>
    new APIError(ErrorCode.MISSING_API_KEY, 'API key is required. Provide it in the X-API-Key header.', 401),

  unauthorized: (message: string = 'Unauthorized') =>
    new APIError(ErrorCode.UNAUTHORIZED, message, 401),

  validationError: (message: string, details?: Record<string, any>) =>
    new APIError(ErrorCode.VALIDATION_ERROR, message, 400, details),

  textTooLong: (max: number, actual: number) =>
    new APIError(
      ErrorCode.INVALID_TEXT_LENGTH,
      `Text too long. Maximum ${max} characters, got ${actual}`,
      400,
      { max, actual }
    ),

  rateLimitExceeded: (retryAfter: number, limit: number) =>
    new APIError(
      ErrorCode.RATE_LIMIT_EXCEEDED,
      'Rate limit exceeded. Please try again later.',
      429,
      { retryAfter, limit }
    ),

  databaseError: (message: string, details?: Record<string, any>) =>
    new APIError(ErrorCode.DATABASE_ERROR, message, 500, details),

  resourceNotFound: (resource: string, id?: string) =>
    new APIError(
      ErrorCode.RESOURCE_NOT_FOUND,
      `${resource} not found${id ? `: ${id}` : ''}`,
      404,
      { resource, id }
    ),

  routeNotFound: (method: string, path: string) =>
    new APIError(
      ErrorCode.ROUTE_NOT_FOUND,
      `Route ${method} ${path} not found`,
      404,
      { method, path }
    ),

  serviceUnavailable: (message: string = 'Service temporarily unavailable') =>
    new APIError(ErrorCode.SERVICE_UNAVAILABLE, message, 503),

  circuitBreakerOpen: () =>
    new APIError(
      ErrorCode.CIRCUIT_BREAKER_OPEN,
      'Service temporarily unavailable due to high error rate. Please try again later.',
      503
    ),
};
