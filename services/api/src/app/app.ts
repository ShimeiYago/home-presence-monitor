import { Hono } from "hono";
import { cors } from "hono/cors";
import { randomUUID } from "crypto";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { devicesRoute } from "./routes/v1/devices";
import { healthRoute } from "./routes/healthz";

type AppContext = {
  Variables: {
    requestId: string;
  };
};

export const createApp = () => {
  const app = new Hono<AppContext>();
  const isTest = process.env.NODE_ENV === "test";
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  app.use("*", async (c, next) => {
    if (isTest) {
      await next();
      return;
    }
    const start = Date.now();
    let error: unknown;
    const requestId = randomUUID();
    c.set("requestId", requestId);

    try {
      await next();
    } catch (err) {
      error = err;
      throw err;
    } finally {
      const durationMs = Date.now() - start;
      const url = c.req.url;
      const method = c.req.method;
      const status = c.res?.status ?? (error ? 500 : 0);

      const logPayload: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        level: "info",
        message: "access",
        requestId,
        method,
        url,
        path: new URL(url).pathname,
        status,
        durationMs,
      };

      console.log(JSON.stringify(logPayload));
    }
  });
  app.use(
    "*",
    cors({
      origin: (origin) => {
        if (!origin || allowedOrigins.length === 0) {
          return undefined;
        }
        return allowedOrigins.includes(origin) ? origin : undefined;
      },
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
    }),
  );

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  app.route("/healthz", healthRoute);
  app.route("/v1/devices", devicesRoute);

  return app;
};
