import type { Context } from "hono";
import { z } from "zod";
import { ApiError } from "./errors";

export const parseJsonBody = async <T>(
  c: Context,
  schema: z.ZodSchema<T>,
): Promise<T> => {
  if (typeof c.req.header === "function") {
    const contentType = c.req.header("content-type");
    if (!contentType?.toLowerCase().includes("application/json")) {
      throw new ApiError(400, "BAD_REQUEST", "Invalid content-type");
    }
  }
  try {
    const json = await c.req.json();
    return schema.parse(json);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw error;
    }
    throw new ApiError(400, "BAD_REQUEST", "Invalid JSON body");
  }
};

export const parseQuery = <T>(c: Context, schema: z.ZodSchema<T>): T =>
  schema.parse(c.req.query());

export const parseParams = <T>(c: Context, schema: z.ZodSchema<T>): T =>
  schema.parse(c.req.param());
