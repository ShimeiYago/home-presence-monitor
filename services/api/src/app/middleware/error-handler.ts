import type { ErrorHandler, NotFoundHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { ApiError } from "../lib/errors";

export const errorHandler: ErrorHandler = (err, c) => {
  const isTest = process.env.NODE_ENV === "test";
  const requestId = c.get("requestId");
  const baseLog = {
    timestamp: new Date().toISOString(),
    requestId,
    method: c.req.method,
    url: c.req.url,
    path: new URL(c.req.url).pathname,
  };

  if (err instanceof ApiError) {
    if (err.status >= 500) {
      const cause = err.cause;
      if (!isTest) {
        console.error(
          JSON.stringify({
            ...baseLog,
            level: "error",
            message: err.message,
            code: err.code,
            status: err.status,
            causeName: cause instanceof Error ? cause.name : undefined,
            causeMessage: cause instanceof Error ? cause.message : undefined,
            causeStack: cause instanceof Error ? cause.stack : undefined,
            cause: cause && !(cause instanceof Error) ? cause : undefined,
          }),
        );
      }
    }
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
        },
      },
      err.status,
    );
  }

  if (err instanceof ZodError) {
    const status: ContentfulStatusCode = 400;
    return c.json(
      {
        error: {
          code: "BAD_REQUEST",
          message: err.message,
        },
      },
      status,
    );
  }

  if (!isTest) {
    console.error(
      JSON.stringify({
        ...baseLog,
        level: "error",
        message: "unhandled_error",
        status: 500,
        errorName: err instanceof Error ? err.name : "UnknownError",
        errorMessage: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }),
    );
  }
  const status: ContentfulStatusCode = 500;
  return c.json(
    {
      error: {
        code: "INTERNAL",
        message: "Internal Server Error",
      },
    },
    status,
  );
};

export const notFoundHandler: NotFoundHandler = (c) =>
  c.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "Not Found",
      },
    },
    404 as ContentfulStatusCode,
  );
