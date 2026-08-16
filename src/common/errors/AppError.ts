// ─── Base application error ───────────────────────────────────────────────────
//
// All domain/application errors extend AppError.
// The global error-handler middleware reads these fields to build the response.

export class AppError extends Error {
  /** HTTP status code to send to the client. */
  public readonly statusCode: number;
  /** Machine-readable error code used in the response envelope. */
  public readonly code: string;
  /** Optional structured details (e.g. field-level validation issues). */
  public readonly details?: unknown;
  /** Whether this error is safe to expose to the client (vs masking as 500). */
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    details?: unknown,
    isOperational = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = isOperational;

    // Preserve stack trace in V8
    Error.captureStackTrace(this, this.constructor);
  }
}
