import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "TOO_MANY_REQUESTS"
  | "INTERNAL"
  | "INVALID_CURSOR"
  | (string & {});

export class ApiError extends Error {
  public readonly status: ContentfulStatusCode;
  public readonly code: ApiErrorCode;
  public readonly cause?: unknown;

  constructor(
    status: ContentfulStatusCode,
    code: ApiErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.cause = cause;
  }
}

export const badRequest = (
  message: string,
  code: ApiErrorCode = "BAD_REQUEST",
) => new ApiError(400, code, message);

export const unauthorized = (
  message: string,
  code: ApiErrorCode = "UNAUTHORIZED",
) => new ApiError(401, code, message);

export const forbidden = (message: string, code: ApiErrorCode = "FORBIDDEN") =>
  new ApiError(403, code, message);

export const notFound = (message: string, code: ApiErrorCode = "NOT_FOUND") =>
  new ApiError(404, code, message);

export const conflict = (message: string, code: ApiErrorCode = "CONFLICT") =>
  new ApiError(409, code, message);
