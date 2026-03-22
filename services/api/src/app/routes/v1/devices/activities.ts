import { Hono } from "hono";
import { z } from "zod";
import {
  GetActivitiesResponse,
  PostActivityRequest,
  PostActivityResponse,
} from "@homePresenceMonitor/contracts/api";
import {
  putActivity,
  queryActivitiesByDeviceAndRange,
} from "@homePresenceMonitor/db/schema/activities";
import { badRequest } from "src/app/lib/errors";
import { parseJsonBody, parseParams, parseQuery } from "src/app/lib/zod";
import { deviceParamsSchema } from "./common";

export const deviceActivitiesRoute = new Hono();
const ACTIVITY_TTL_SECONDS = 60 * 60 * 24 * 30;
const iso8601Schema = z.string().datetime({ offset: true });
const getActivitiesQuerySchema = z.object({
  from: iso8601Schema,
  to: iso8601Schema,
});
const postActivityRequestSchema = z.object({
  windowStart: iso8601Schema,
  windowEnd: iso8601Schema,
  motionCount: z.number().int().nonnegative(),
});
const toTtlEpoch = (createdAt: string, ttlSeconds: number): number =>
  Math.floor(Date.parse(createdAt) / 1000) + ttlSeconds;

deviceActivitiesRoute.get("/", async (c) => {
  const { deviceId } = parseParams(c, deviceParamsSchema);
  const { from, to } = parseQuery(c, getActivitiesQuerySchema);

  if (from > to) {
    throw badRequest("from must be less than or equal to to");
  }

  const records = await queryActivitiesByDeviceAndRange({ deviceId, from, to });

  return c.json<GetActivitiesResponse>(
    {
      deviceId,
      activities: records.map((record) => ({
        windowStart: record.windowStart,
        windowEnd: record.windowEnd,
        motionCount: record.motionCount,
      })),
    },
    200,
  );
});

deviceActivitiesRoute.post("/", async (c) => {
  const { deviceId } = parseParams(c, deviceParamsSchema);
  const body = await parseJsonBody<PostActivityRequest>(
    c,
    postActivityRequestSchema,
  );

  if (body.windowStart > body.windowEnd) {
    throw badRequest("windowStart must be less than or equal to windowEnd");
  }

  const createdAt = new Date().toISOString();
  const ttl = toTtlEpoch(createdAt, ACTIVITY_TTL_SECONDS);

  await putActivity({
    deviceId,
    windowStart: body.windowStart,
    windowEnd: body.windowEnd,
    motionCount: body.motionCount,
    createdAt,
    ttl,
  });

  return c.json<PostActivityResponse>(
    {
      recordedAt: createdAt,
    },
    201,
  );
});
