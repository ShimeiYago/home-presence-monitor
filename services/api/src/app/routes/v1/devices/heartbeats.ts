import { Hono } from "hono";
import { z } from "zod";
import {
  GetHeartbeatsResponse,
  GetLatestHeartbeatResponse,
  PostHeartbeatRequest,
  PostHeartbeatResponse,
} from "@home-presence-monitor/contracts/api";
import {
  queryHeartbeatsByDeviceAndRange,
  putHeartbeat,
  queryLatestHeartbeatByDevice,
} from "@home-presence-monitor/db/schema/heartbeats";
import { updateLatestObservedSourceIp } from "@home-presence-monitor/db/schema/monitor-states";
import { badRequest, notFound } from "src/app/lib/errors";
import { getSourceIp } from "src/app/lib/source-ip";
import { parseJsonBody, parseQuery } from "src/app/lib/zod";
import { parseConfiguredDevice } from "./common";

export const deviceHeartbeatsRoute = new Hono();
const HEARTBEAT_TTL_SECONDS = 60 * 60 * 24 * 30;
const iso8601Schema = z.string().datetime({ offset: true });
const getHeartbeatsQuerySchema = z.object({
  from: iso8601Schema,
  to: iso8601Schema,
});
const postHeartbeatRequestSchema = z.object({
  timestamp: z.string().datetime({ offset: true }),
});
const toTtlEpoch = (createdAt: string, ttlSeconds: number): number =>
  Math.floor(Date.parse(createdAt) / 1000) + ttlSeconds;

deviceHeartbeatsRoute.get("/", async (c) => {
  const { id: deviceId } = parseConfiguredDevice(c);
  const { from, to } = parseQuery(c, getHeartbeatsQuerySchema);

  if (from > to) {
    throw badRequest("from must be less than or equal to to");
  }

  const records = await queryHeartbeatsByDeviceAndRange({ deviceId, from, to });

  return c.json<GetHeartbeatsResponse>(
    {
      deviceId,
      heartbeats: records.map((record) => ({
        timestamp: record.timestamp,
      })),
    },
    200,
  );
});

deviceHeartbeatsRoute.get("/latest", async (c) => {
  const { id: deviceId } = parseConfiguredDevice(c);
  const latestHeartbeat = await queryLatestHeartbeatByDevice({ deviceId });

  if (!latestHeartbeat) {
    throw notFound("Latest heartbeat not found");
  }

  return c.json<GetLatestHeartbeatResponse>(
    {
      deviceId,
      lastHeartbeatAt: latestHeartbeat.timestamp,
    },
    200,
  );
});

deviceHeartbeatsRoute.post("/", async (c) => {
  const { id: deviceId } = parseConfiguredDevice(c);
  const body = await parseJsonBody<PostHeartbeatRequest>(
    c,
    postHeartbeatRequestSchema,
  );
  const createdAt = new Date().toISOString();
  const ttl = toTtlEpoch(createdAt, HEARTBEAT_TTL_SECONDS);

  await putHeartbeat({
    deviceId,
    timestamp: body.timestamp,
    createdAt,
    ttl,
  });
  const sourceIp = getSourceIp(c.req.header("x-forwarded-for"));

  if (sourceIp) {
    await updateLatestObservedSourceIp({
      deviceId,
      sourceIp,
      observedAt: createdAt,
    });
  }

  return c.json<PostHeartbeatResponse>(
    {
      recordedAt: createdAt,
    },
    201,
  );
});
